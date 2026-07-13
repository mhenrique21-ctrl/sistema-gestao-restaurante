param(
    [Parameter(Mandatory=$true)][string]$PrinterName,
    [Parameter(Mandatory=$true)][string]$FilePath
)

$signature = @'
[DllImport("winspool.drv", CharSet = CharSet.Auto, SetLastError = true)]
public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

[DllImport("winspool.drv", CharSet = CharSet.Auto, SetLastError = true)]
public static extern bool ClosePrinter(IntPtr hPrinter);

[DllImport("winspool.drv", CharSet = CharSet.Auto, SetLastError = true)]
public static extern bool StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFOA di);

[DllImport("winspool.drv", CharSet = CharSet.Auto, SetLastError = true)]
public static extern bool EndDocPrinter(IntPtr hPrinter);

[DllImport("winspool.drv", CharSet = CharSet.Auto, SetLastError = true)]
public static extern bool StartPagePrinter(IntPtr hPrinter);

[DllImport("winspool.drv", CharSet = CharSet.Auto, SetLastError = true)]
public static extern bool EndPagePrinter(IntPtr hPrinter);

[DllImport("winspool.drv", CharSet = CharSet.Auto, SetLastError = true)]
public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
public struct DOCINFOA
{
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
}
'@

Add-Type -MemberDefinition $signature -Name RawPrinterHelper -Namespace WinSpool -UsingNamespace System.Runtime.InteropServices

if (-not (Test-Path $FilePath)) {
    Write-Error "Arquivo nao encontrado: $FilePath"
    exit 1
}

$bytes = [System.IO.File]::ReadAllBytes($FilePath)

$hPrinter = [IntPtr]::Zero
$ok = [WinSpool.RawPrinterHelper]::OpenPrinter($PrinterName, [ref]$hPrinter, [IntPtr]::Zero)
if (-not $ok) {
    Write-Error "Falha ao abrir impressora '$PrinterName' (Win32 error $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
    exit 1
}

try {
    $di = New-Object WinSpool.RawPrinterHelper+DOCINFOA
    $di.pDocName = "Cupom ESC/POS"
    $di.pDataType = "RAW"

    $ok = [WinSpool.RawPrinterHelper]::StartDocPrinter($hPrinter, 1, [ref]$di)
    if (-not $ok) { throw "Falha em StartDocPrinter (Win32 error $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error()))" }

    $ok = [WinSpool.RawPrinterHelper]::StartPagePrinter($hPrinter)
    if (-not $ok) { throw "Falha em StartPagePrinter (Win32 error $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error()))" }

    $written = 0
    $ok = [WinSpool.RawPrinterHelper]::WritePrinter($hPrinter, $bytes, $bytes.Length, [ref]$written)
    if (-not $ok) { throw "Falha em WritePrinter (Win32 error $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error()))" }

    [WinSpool.RawPrinterHelper]::EndPagePrinter($hPrinter) | Out-Null
    [WinSpool.RawPrinterHelper]::EndDocPrinter($hPrinter) | Out-Null

    Write-Output "OK: $written bytes enviados para '$PrinterName'"
}
finally {
    [WinSpool.RawPrinterHelper]::ClosePrinter($hPrinter) | Out-Null
}
