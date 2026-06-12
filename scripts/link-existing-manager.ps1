[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

function Read-RequiredValue {
  param([Parameter(Mandatory)][string]$Prompt)
  do { $value = (Read-Host $Prompt).Trim() } while ([string]::IsNullOrWhiteSpace($value))
  return $value
}

function ConvertTo-SqlLiteral {
  param([Parameter(Mandatory)][string]$Value)
  return $Value.Replace("'", "''")
}

$staffId = Read-RequiredValue "Existing canonical staff profile UUID"
$authUserInput = Read-RequiredValue "Supabase Auth user UUID"
$authUserId = [Guid]::Empty
if (-not [Guid]::TryParse($authUserInput, [ref]$authUserId)) { throw "The Auth user UUID is invalid." }
$email = (Read-RequiredValue "Invited manager email").ToLowerInvariant()
if ($email -notmatch "^[^@\s]+@[^@\s]+\.[^@\s]+$") { throw "The email address is invalid." }
$confirmation = Read-Host "Type LINK to connect this Auth user to the existing profile"
if ($confirmation -cne "LINK") { throw "Manager linking cancelled." }

$staffSql = ConvertTo-SqlLiteral $staffId
$authSql = ConvertTo-SqlLiteral $authUserId.ToString()
$emailSql = ConvertTo-SqlLiteral $email
$temporarySql = Join-Path ([IO.Path]::GetTempPath()) ("jan-link-manager-{0}.sql" -f [Guid]::NewGuid())
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$locationPushed = $false

$sql = @"
begin;
do `$link`$
declare
  v_staff_id text := '$staffSql';
  v_auth_user_id uuid := '$authSql'::uuid;
  v_email text := lower('$emailSql');
  v_auth_email text;
  v_profile_name text;
  v_grantor uuid;
begin
  select lower(email) into v_auth_email from auth.users where id = v_auth_user_id;
  if not found then raise exception 'The supplied Auth user does not exist.'; end if;
  if v_auth_email is distinct from v_email then raise exception 'The Auth email does not match.'; end if;

  select full_name into v_profile_name from public.staff_profiles where id = v_staff_id;
  if not found then raise exception 'The canonical staff profile does not exist.'; end if;

  if exists (select 1 from public.staff_profiles where auth_user_id = v_auth_user_id and id <> v_staff_id) then
    raise exception 'The Auth user is already linked to another profile.';
  end if;
  if exists (select 1 from public.staff_accounts where auth_user_id = v_auth_user_id and staff_id <> v_staff_id) then
    raise exception 'The Auth user is already linked to another account.';
  end if;
  if exists (select 1 from public.staff_accounts where lower(email) = v_email and staff_id <> v_staff_id) then
    raise exception 'The email is already linked to another account.';
  end if;

  select coalesce(
    (select access_granted_by from public.staff_accounts where staff_id = v_staff_id),
    (select id from public.staff_accounts where role = 'manager' and active = true and staff_id <> v_staff_id order by created_at limit 1)
  ) into v_grantor;
  if v_grantor is null then raise exception 'An existing active manager is required to grant access.'; end if;

  update public.staff_profiles
  set auth_user_id = v_auth_user_id, email = v_email, active = true
  where id = v_staff_id;

  insert into public.staff_accounts (
    auth_user_id, staff_id, full_name, email, role, active,
    access_granted_by, access_granted_at, disabled_by, disabled_at
  ) values (
    v_auth_user_id, v_staff_id, v_profile_name, v_email, 'manager', true,
    v_grantor, now(), null, null
  )
  on conflict (staff_id) do update set
    auth_user_id = excluded.auth_user_id,
    full_name = excluded.full_name,
    email = excluded.email,
    role = 'manager',
    active = true,
    access_granted_by = coalesce(public.staff_accounts.access_granted_by, excluded.access_granted_by),
    access_granted_at = coalesce(public.staff_accounts.access_granted_at, excluded.access_granted_at),
    disabled_by = null,
    disabled_at = null;
end
`$link`$;

select
  count(*) filter (where a.role = 'manager' and a.active) as matching_active_manager,
  bool_and(p.id = a.staff_id and p.auth_user_id = a.auth_user_id) as profile_account_link_valid
from public.staff_accounts a
join public.staff_profiles p on p.id = a.staff_id
where a.auth_user_id = '$authSql'::uuid;
commit;
"@

try {
  [IO.File]::WriteAllText($temporarySql, $sql, [Text.UTF8Encoding]::new($false))
  Push-Location -LiteralPath $repositoryRoot
  $locationPushed = $true
  & npx.cmd --yes supabase db query --linked --output table --file $temporarySql
  if ($LASTEXITCODE -ne 0) { throw "Supabase rejected the manager link." }
  Write-Host "The existing staff profile and manager account were linked and verified."
} finally {
  if ($locationPushed) { Pop-Location }
  if (Test-Path -LiteralPath $temporarySql) { Remove-Item -LiteralPath $temporarySql -Force }
  Remove-Variable sql,email,emailSql,authUserInput,authSql,staffId,staffSql -ErrorAction SilentlyContinue
}
