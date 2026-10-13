const form = document.querySelector('form')!, message = document.querySelector('#access-message')!;
form.addEventListener('submit', async event => {
  event.preventDefault(); const button = form.querySelector('button')!, input = form.querySelector('input')!;
  button.disabled = true; message.textContent = 'Проверяем доступ…';
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10_000);
  try {
    const response = await fetch('/api/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: input.value }), signal: controller.signal });
    input.value = '';
    if (!response.ok) throw new Error(response.status === 429 ? 'Слишком много попыток. Подождите минуту.' : 'Ключ не принят. Проверьте ключ на сервере.');
    location.reload();
  } catch (error) { message.textContent = (error as Error).name === 'TypeError' ? 'Сервер недоступен. Проверьте Wi-Fi и адрес.' : (error as Error).message; }
  finally { clearTimeout(timer); button.disabled = false; }
});
