$typeDefinition = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class CumtForegroundWindow {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);
}
'@

Add-Type -TypeDefinition $typeDefinition
$lastState = ''

while ($true) {
  $foreground = [CumtForegroundWindow]::GetForegroundWindow()
  $className = New-Object Text.StringBuilder 256
  [void][CumtForegroundWindow]::GetClassName($foreground, $className, $className.Capacity)
  $currentClass = $className.ToString()
  $state = if ($currentClass -eq 'Progman' -or $currentClass -eq 'WorkerW') { 'DESKTOP' } else { 'APP' }
  if ($state -ne $lastState) {
    [Console]::Out.WriteLine($state)
    [Console]::Out.Flush()
    $lastState = $state
  }
  Start-Sleep -Milliseconds 350
}
