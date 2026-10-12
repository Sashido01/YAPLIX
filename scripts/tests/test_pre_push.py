"""Real Git push tests; all remotes and temporary files stay inside this clone."""

import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HOOK = ROOT / ".githooks" / "pre-push"


def git_shell():
    if os.name != "nt":
        return shutil.which("sh")
    git = Path(shutil.which("git") or "git")
    for candidate in (git.parent.parent / "bin" / "sh.exe",
                      git.parent / "sh.exe"):
        if candidate.is_file():
            return str(candidate)
    return shutil.which("sh")


class HookProtocolTests(unittest.TestCase):
    def test_destination_ref_protocol(self):
        shell = git_shell()
        self.assertIsNotNone(shell, "Git for Windows sh or POSIX sh is required")
        oid, zero = "1" * 40, "0" * 40
        cases = {
            "empty": ("", 0),
            "feature": (f"refs/heads/main {oid} refs/heads/feature/main {zero}\n", 0),
            "tag_named_main": (f"refs/tags/main {oid} refs/tags/main {zero}\n", 0),
            "main": (f"refs/heads/main {oid} refs/heads/main {oid}\n", 1),
            "explicit_refspec": (f"refs/heads/fix/demo {oid} refs/heads/main {oid}\n", 1),
            "create_main": (f"HEAD {oid} refs/heads/main {zero}\n", 1),
            "delete_main": (f"(delete) {zero} refs/heads/main {oid}\n", 1),
            "mixed": (f"HEAD {oid} refs/heads/feature/test {zero}\n"
                      f"HEAD {oid} refs/heads/main {oid}\n", 1),
        }
        for name, (payload, expected) in cases.items():
            with self.subTest(name=name):
                result = subprocess.run(
                    [shell, str(HOOK), "arbitrary-remote", "unused-local-url"],
                    input=payload, text=True, capture_output=True, cwd=ROOT,
                )
                self.assertEqual(result.returncode, expected, result.stderr)
                if expected:
                    self.assertIn("Pull Request", result.stderr)


class PushIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="hook-test-", dir=ROOT)
        self.addCleanup(self.cleanup_fixture)
        parent = Path(self.directory.name)
        self.repo, self.remote = parent / "working copy", parent / "remote.git"
        self.repo.mkdir()
        # Ignore ambient Git settings, author data, signing and hooks.
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        self.env.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
                        GIT_TERMINAL_PROMPT="0")
        self.git("-c", "init.templateDir=", "init", "-b", "main", str(self.repo), cwd=parent)
        self.git("-c", "init.templateDir=", "init", "--bare", "-b", "main",
                 str(self.remote), cwd=parent)
        self.git("config", "--local", "user.name", "Hook Test")
        self.git("config", "--local", "user.email", "hook-test@example.invalid")
        self.git("config", "--local", "core.autocrlf", "false")
        (self.repo / "fixture.txt").write_bytes(b"initial\n")
        self.git("add", "fixture.txt")
        self.git("commit", "-m", "test: initial local fixture")
        self.git("remote", "add", "sandbox", str(self.remote))
        self.git("push", "sandbox", "main")  # Only this local bare fixture.
        self.initial = self.remote_ref("main")
        (self.repo / ".githooks").mkdir()
        installed = self.repo / ".githooks" / "pre-push"
        shutil.copyfile(HOOK, installed)
        installed.chmod(0o755)
        self.git("config", "--local", "core.hooksPath", ".githooks")
        (self.repo / "fixture.txt").write_bytes(b"new change\n")
        self.git("add", "fixture.txt")
        self.git("commit", "-m", "test: candidate local fixture")

    def cleanup_fixture(self):
        # Windows may briefly retain a Git/antivirus handle after push exits.
        # Retry only sharing/access failures; never suppress a cleanup failure.
        last_error = None
        for delay in (0, 0.05, 0.1, 0.2, 0.4, 0.8):
            if delay:
                time.sleep(delay)
            try:
                self.directory.cleanup()
                return
            except PermissionError as exc:
                if os.name != "nt" or exc.winerror not in (5, 32):
                    raise
                last_error = exc
        raise last_error

    def git(self, *args, cwd=None, check=True):
        result = subprocess.run(["git", *args], cwd=cwd or self.repo,
                                env=self.env, capture_output=True, text=True)
        if check:
            self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def remote_ref(self, branch):
        result = self.git("--git-dir", str(self.remote), "rev-parse", "--verify",
                          f"refs/heads/{branch}", check=False)
        return result.stdout.strip() if result.returncode == 0 else None

    def assert_blocked(self, *push_args):
        before = self.git("--git-dir", str(self.remote), "show-ref").stdout
        result = self.git("push", *push_args, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("YAPLIX: push to refs/heads/main is blocked", result.stderr)
        self.assertEqual(self.git("--git-dir", str(self.remote), "show-ref").stdout, before)

    def test_normal_push_to_main_blocked(self):
        self.git("config", "branch.main.remote", "sandbox")
        self.git("config", "branch.main.merge", "refs/heads/main")
        self.assert_blocked()

    def test_feature_to_main_refspec_blocked(self):
        self.git("switch", "-c", "feature/demo")
        self.assert_blocked("sandbox", "feature/demo:main")

    def test_force_push_main_blocked(self):
        self.assert_blocked("--force", "sandbox", "HEAD:refs/heads/main")

    def test_delete_main_blocked(self):
        self.assert_blocked("sandbox", "--delete", "main")

    def test_mixed_push_changes_no_remote_refs(self):
        self.assert_blocked("sandbox", "HEAD:refs/heads/feature/demo", "HEAD:refs/heads/main")
        self.assertIsNone(self.remote_ref("feature/demo"))

    def test_url_destination_blocked(self):
        self.assert_blocked(str(self.remote), "HEAD:main")

    def test_create_remote_main_blocked(self):
        empty_remote = Path(self.directory.name) / "empty.git"
        self.git("-c", "init.templateDir=", "init", "--bare", str(empty_remote))
        result = self.git("push", str(empty_remote), "HEAD:main", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("YAPLIX: push to refs/heads/main is blocked", result.stderr)
        self.assertNotEqual(self.git("--git-dir", str(empty_remote), "rev-parse",
                                    "--verify", "refs/heads/main", check=False).returncode, 0)

    def test_tag_named_main_allowed(self):
        self.git("tag", "main")
        self.git("push", "sandbox", "refs/tags/main:refs/tags/main")
        self.assertEqual(self.git("--git-dir", str(self.remote), "rev-parse",
                                  "refs/tags/main").stdout.strip(),
                         self.git("rev-parse", "HEAD").stdout.strip())
        self.assertEqual(self.remote_ref("main"), self.initial)

    def test_main_to_feature_allowed(self):
        self.git("push", "sandbox", "main:refs/heads/feature/demo")
        self.assertEqual(self.remote_ref("feature/demo"),
                         self.git("rev-parse", "HEAD").stdout.strip())
        self.assertEqual(self.remote_ref("main"), self.initial)

    def test_normal_feature_push_allowed(self):
        self.git("switch", "-c", "feature/demo")
        self.git("push", "-u", "sandbox", "feature/demo")
        (self.repo / "fixture.txt").write_bytes(b"another change\n")
        self.git("add", "fixture.txt")
        self.git("commit", "-m", "test: next local change")
        self.git("push")
        self.assertEqual(self.remote_ref("feature/demo"),
                         self.git("rev-parse", "HEAD").stdout.strip())
        self.assertEqual(self.remote_ref("main"), self.initial)


if __name__ == "__main__":
    unittest.main()
