# scripts\db.ps1 — apply a migration SQL file directly to Supabase (no DB password needed)
# Usage:
#   .\scripts\db.ps1 apply  supabase/migrations/0070_foo.sql
#   .\scripts\db.ps1 query  "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;"
#   .\scripts\db.ps1 status          # show which migrations are tracked remotely
#
# Requires: Supabase CLI logged in (supabase login), curl.exe (built into Windows 10+)

param(
  [Parameter(Position=0,Mandatory)] [string] $Command,
  [Parameter(Position=1)]           [string] $Arg1
)

$PROJECT = "vdvpwbhkdlbskewfgref"
$API     = "https://api.supabase.com/v1/projects/$PROJECT/database/query"

# ── token from Windows Credential Manager ───────────────────────────────────
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Text;
using System.Web.Script.Serialization;
using System.IO; using System.Diagnostics;
public class SupaDB {
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
  static extern bool CredRead(string t,uint tp,uint f,out IntPtr p);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr p);
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
  struct CRED { public uint Fl,Tp; public IntPtr TN,Co; public long LW; public uint BS; public IntPtr BB,Pe,AC,At,TA,UN; }
  public static string Token() {
    IntPtr p=IntPtr.Zero;
    if(!CredRead("Supabase CLI:supabase",1,0,out p)) return null;
    var c=Marshal.PtrToStructure<CRED>(p);
    var b=new byte[c.BS]; Marshal.Copy(c.BB,b,0,(int)c.BS); CredFree(p);
    return Encoding.UTF8.GetString(b);
  }
  public static string Post(string sql, string token, string api) {
    var j=new JavaScriptSerializer(); j.MaxJsonLength=int.MaxValue;
    var body=j.Serialize(new{query=sql});
    var tmp=Path.GetTempFileName()+".json";
    File.WriteAllText(tmp,body,Encoding.UTF8);
    var args="-s -w \"\n%{http_code}\" -X POST \""+api+"\" -H \"Authorization: Bearer "+token+"\" -H \"Content-Type: application/json\" --data-binary \"@"+tmp+"\"";
    var psi=new ProcessStartInfo("curl.exe"){Arguments=args,RedirectStandardOutput=true,UseShellExecute=false};
    var proc=Process.Start(psi); var out2=proc.StandardOutput.ReadToEnd(); proc.WaitForExit(); File.Delete(tmp);
    return out2;
  }
}
"@ -ReferencedAssemblies "System.Web.Extensions" -ErrorAction SilentlyContinue

$token = [SupaDB]::Token()
if (-not $token) { Write-Error "No Supabase token found. Run: supabase login"; exit 1 }

function Invoke-SQL($sql) {
  $raw   = [SupaDB]::Post($sql, $token, $API)
  $lines = $raw -split "`n"
  $http  = $lines[-1].Trim()
  $body  = ($lines[0..($lines.Count-2)] -join "`n").Trim()
  return [pscustomobject]@{ Status=$http; Body=$body }
}

# ── commands ─────────────────────────────────────────────────────────────────
switch ($Command.ToLower()) {

  "apply" {
    if (-not $Arg1) { Write-Error "Usage: db.ps1 apply <path-to-sql-file>"; exit 1 }
    $file = Resolve-Path $Arg1 -ErrorAction Stop
    $sql  = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)

    Write-Host "Applying $([System.IO.Path]::GetFileName($file))..." -ForegroundColor Cyan
    $r = Invoke-SQL $sql
    if ($r.Status -ne "201") {
      Write-Host "FAILED (HTTP $($r.Status))" -ForegroundColor Red
      Write-Host $r.Body
      exit 1
    }
    Write-Host "Applied OK" -ForegroundColor Green

    # Auto-register in migration tracker
    $fname   = [System.IO.Path]::GetFileNameWithoutExtension($file)
    $version = $fname -replace '^(\d+).*','$1'
    if ($version -match '^\d+$') {
      $reg = "INSERT INTO supabase_migrations.schema_migrations(version,statements,name) VALUES ('$version',ARRAY[]::text[],'$fname') ON CONFLICT(version) DO NOTHING;"
      $r2 = Invoke-SQL $reg
      if ($r2.Status -eq "201") {
        Write-Host "Registered as version $version in migration tracker" -ForegroundColor DarkGray
      }
    }
  }

  "query" {
    if (-not $Arg1) { Write-Error "Usage: db.ps1 query <sql>"; exit 1 }
    $r = Invoke-SQL $Arg1
    Write-Host "HTTP $($r.Status)"
    Write-Host $r.Body
  }

  "status" {
    $r = Invoke-SQL "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;"
    if ($r.Status -eq "201") {
      $versions = ($r.Body | ConvertFrom-Json) | ForEach-Object { $_.version }
      Write-Host "Tracked migrations ($($versions.Count)):" -ForegroundColor Cyan
      Write-Host ($versions -join "  ")
    } else {
      Write-Host "HTTP $($r.Status): $($r.Body)" -ForegroundColor Red
    }
  }

  default {
    Write-Host "Commands: apply <file>  |  query <sql>  |  status"
  }
}
