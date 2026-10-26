// Platform-neutral installation transaction. Adapters own OS operations only.
export class InstallError extends Error {
 constructor(code){super(code);this.code=code;}
}
export const messages={
 UNSUPPORTED_OS:'Эта версия рассчитана на Ubuntu 24.04 x64 или Windows 10/11 x64.',
 INTEGRITY:'Установочный файл повреждён. Скачайте его заново.',
 DATA_INTEGRITY:'Обнаружена проблема с базой игр. Данные сохранены. Восстановите проверенную резервную копию перед обновлением.',
 SPACE:'Недостаточно свободного места. Освободите место и нажмите «Повторить».',
 PERMISSION:'Не удалось записать файлы. Проверьте доступ к своему профилю.',
 OFFLINE:'Для недостающих компонентов нужен интернет. Подключитесь к сети и нажмите «Повторить».',
 DEPENDENCIES:'В комплекте не хватает совместимой библиотеки. Скачайте полный установщик YAPLIX; системные пакеты не изменялись.',
 BUSY:'Другой установщик YAPLIX ещё работает. Дождитесь его завершения.',
 VERIFY:'Проверка запуска не пройдена. Предыдущая версия и резервные копии сохранены.',
 SANDBOX:'Защищённый Chromium не смог запуститься. Защита не отключалась. Передайте журнал установки организатору.',
 LITE_BROWSER:'Lite не прошёл проверку защищённого Google Chrome. Попробуйте полный установщик с отдельным Chromium. Если ОС блокирует защищённый запуск, установка также остановится; настройки защиты не меняются.',
 ROLLBACK:'Обновление не завершено; автоматический возврат не подтверждён. Предыдущий пакет и копия базы сохранены.',
 START:'Не удалось запустить YAPLIX. Откройте журнал установки и повторите попытку.',
 BROWSER:'Не удалось открыть браузер. Назначьте браузер по умолчанию и повторите попытку.'
};
export function failureCode(error){if(['EACCES','EPERM','EROFS'].includes(error?.code))return 'PERMISSION';if(error?.code==='ENOSPC')return 'SPACE';return Object.hasOwn(messages,error?.code)?error.code:'START';}
export function planInstallation(facts){
 if(!facts.supported)throw new InstallError('UNSUPPORTED_OS');
 if(!facts.integrity)throw new InstallError('INTEGRITY');
 if(!facts.dataIntegrity)throw new InstallError('DATA_INTEGRITY');
 if(!facts.writable)throw new InstallError('PERMISSION');
 if(facts.freeBytes<facts.requiredBytes)throw new InstallError('SPACE');
 if(facts.needsNetwork&&!facts.online)throw new InstallError('OFFLINE');
 return {action:facts.currentSame?'reuse':facts.installedVersion?'update':'install',dependencies:facts.dependencies??[],needsNetwork:!!facts.needsNetwork,requiresAdmin:false};
}
export async function runInstallation(adapter,notify=()=>{}){
 let snapshot,changed=false;
 const emit=(stage,code='OK')=>{notify({stage,code});};
 try{
  emit('CHECK');let facts=await adapter.check();
  if(facts.supported&&facts.integrity&&await adapter.recover?.())facts=await adapter.check();
  emit('PLAN');const plan=planInstallation(facts);
  if(plan.action!=='reuse'){
   emit('PREPARE');snapshot=await adapter.prepare(plan);
   emit('INSTALL');changed=true;await adapter.install(plan,snapshot);
  }
  emit('VERIFY');const verified=await adapter.verify(plan);
  if(!verified?.apiReady||!verified?.uiReady||!verified?.sandboxReady)throw new InstallError('VERIFY');
  emit('LAUNCH');const launched=await adapter.launch();
  if(!/^http:\/\/127\.0\.0\.1:[0-9]+\/$/.test(launched?.url??''))throw new InstallError('START');
  await adapter.commit?.();emit('DONE');return {plan,verified,url:launched.url};
 }catch(error){
  const code=failureCode(error);
  if(changed&&snapshot?.rollback){
   emit('ROLLBACK');try{await adapter.rollback(snapshot);}catch{emit('ERROR','ROLLBACK');throw new InstallError('ROLLBACK');}
  }
  emit('ERROR',code);throw new InstallError(code);
 }
}
