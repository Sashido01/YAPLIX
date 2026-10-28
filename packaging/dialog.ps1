param([string]$Message, [switch]$Settings)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
if ($Message) { [System.Windows.Forms.MessageBox]::Show($Message, 'YAPLIX') | Out-Null; exit }
if ($Settings) {
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'YAPLIX — настройка AI'; $form.ClientSize = New-Object System.Drawing.Size(480,230)
  $form.StartPosition = 'CenterScreen'
  $label = New-Object System.Windows.Forms.Label
  $label.Text = 'AI не нужен для запуска. Ключ хранится только на этом компьютере.'
  $label.SetBounds(16,16,448,40)
  $provider = New-Object System.Windows.Forms.ComboBox
  $provider.DropDownStyle = 'DropDownList'; $provider.Items.AddRange(@('Ollama Cloud','OpenRouter Free')); $provider.SelectedIndex=0
  $provider.SetBounds(16,60,448,30)
  $labelKey = New-Object System.Windows.Forms.Label
  $labelKey.Text = 'API-ключ (пустое поле удаляет ключ выбранного провайдера)'; $labelKey.SetBounds(16,100,448,24)
  $key = New-Object System.Windows.Forms.TextBox
  $key.UseSystemPasswordChar=$true; $key.SetBounds(16,128,448,28)
  $save=New-Object System.Windows.Forms.Button
  $save.Text='Сохранить'; $save.DialogResult='OK'; $save.SetBounds(240,180,110,32)
  $cancel=New-Object System.Windows.Forms.Button
  $cancel.Text='Отмена'; $cancel.DialogResult='Cancel'; $cancel.SetBounds(358,180,106,32)
  $form.Controls.AddRange(@($label,$provider,$labelKey,$key,$save,$cancel)); $form.AcceptButton=$save; $form.CancelButton=$cancel
  if ($form.ShowDialog() -ne 'OK') { exit 1 }
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  @{provider=$provider.SelectedItem;key=$key.Text} | ConvertTo-Json -Compress
}
