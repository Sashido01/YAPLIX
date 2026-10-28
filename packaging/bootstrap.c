// Linux self-extracting entry: libc + standard Ubuntu tar/sha256sum only.
#define _GNU_SOURCE
#include <sys/types.h>
#include <sys/wait.h>
#include <sys/statvfs.h>
#include <unistd.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#include <signal.h>
#include <errno.h>
#include <sys/prctl.h>
#ifndef ARCHIVE_BYTES
#error "Build via package-installer.py"
#endif
static volatile sig_atomic_t cancelled=0;
static pid_t active_child=0;
static void interrupt(int sig){cancelled=1;if(active_child>0)kill(active_child,SIGTERM);}
static int run(char *const args[]){
 pid_t p=fork();if(!p){signal(SIGTERM,SIG_DFL);signal(SIGINT,SIG_DFL);prctl(PR_SET_PDEATHSIG,SIGTERM);execv(args[0],args);_exit(127);}
 if(p<0)return 1;active_child=p;int status;pid_t waited;do{waited=waitpid(p,&status,0);}while(waited<0&&errno==EINTR);active_child=0;
 return waited<0||!WIFEXITED(status)||WEXITSTATUS(status);
}
static void error(const char *message){fprintf(stderr,"YAPLIX: %s\n",message);char *const args[]={"/usr/bin/zenity","--error","--title=YAPLIX","--text",(char*)message,NULL};if(!access(args[0],X_OK))run(args);}
int main(int argc,char **argv){
 signal(SIGTERM,interrupt);signal(SIGINT,interrupt);
 if(geteuid()==0){error("Запускайте YAPLIX от обычного пользователя. Административные права не нужны.");return 1;}
 if(access("/usr/bin/tar",X_OK)||access("/usr/bin/sha256sum",X_OK)){error("Недоступны стандартные средства распаковки Ubuntu. ОС не изменялась.");return 1;}
 char directory[PATH_MAX],archive[PATH_MAX+64],node[PATH_MAX+64],script[PATH_MAX+64];
 const char *tmp=getenv("TMPDIR");if(!tmp||tmp[0]!='/')tmp="/tmp";
 if(snprintf(directory,sizeof(directory),"%s/yaplix-XXXXXX",tmp)>=(int)sizeof(directory)||!mkdtemp(directory)){error("Не удалось создать временный каталог YAPLIX.");return 1;}
 int result=1;
 snprintf(archive,sizeof(archive),"%s/payload.tar.xz",directory);
 struct statvfs fs;if(statvfs(directory,&fs)||((unsigned long long)fs.f_bavail*fs.f_frsize)<ARCHIVE_BYTES+UNPACKED_BYTES+67108864ULL){error("Недостаточно места для распаковки YAPLIX.");goto cleanup;}
 FILE *in=fopen("/proc/self/exe","rb"),*out=NULL;if(!in||fseek(in,-(long)ARCHIVE_BYTES,SEEK_END)){error("Установочный файл повреждён.");if(in)fclose(in);goto cleanup;}
 out=fopen(archive,"wb");if(!out){fclose(in);goto cleanup;}
 unsigned char buffer[65536];size_t n;while(!cancelled&&(n=fread(buffer,1,sizeof(buffer),in)))if(fwrite(buffer,1,n,out)!=n){fclose(in);fclose(out);goto cleanup;}fclose(in);if(fclose(out))goto cleanup;
 if(cancelled)goto cleanup;
 int fd[2];if(pipe(fd))goto cleanup;pid_t p=fork();if(!p){dup2(fd[1],STDOUT_FILENO);close(fd[0]);close(fd[1]);execl("/usr/bin/sha256sum","sha256sum",archive,(char*)NULL);_exit(127);}close(fd[1]);char digest[65]={0};size_t got=0;while(got<64){ssize_t r=read(fd[0],digest+got,64-got);if(r<=0)break;got+=r;}close(fd[0]);int status;active_child=p;while(waitpid(p,&status,0)<0&&errno==EINTR){}active_child=0;if(cancelled)goto cleanup;
 if(got!=64||strcmp(digest,ARCHIVE_SHA)||!WIFEXITED(status)||WEXITSTATUS(status)){error("Проверка целостности не пройдена. Получите файл YAPLIX заново.");goto cleanup;}
 char *const extract[]={"/usr/bin/tar","-xJf",archive,"--no-same-owner","--no-same-permissions","-C",directory,NULL};if(run(extract)){if(!cancelled)error("Не удалось распаковать YAPLIX. Проверьте свободное место.");goto cleanup;}if(cancelled)goto cleanup;
 snprintf(node,sizeof(node),"%s/payload/runtime/node",directory);snprintf(script,sizeof(script),"%s/payload/scripts/install-ui.mjs",directory);
 char **args=calloc((size_t)argc+3,sizeof(char*));if(!args)goto cleanup;args[0]=node;args[1]=script;for(int i=1;i<argc;i++)args[i+1]=argv[i];result=run(args);free(args);
cleanup:
 {char *const remove[]={"/usr/bin/rm","-rf","--",directory,NULL};run(remove);}
 return result;
}
