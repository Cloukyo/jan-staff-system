const header = "external_staff_id,full_name,display_name,email,employment_status,start_date,job_role,primary_site,attendance_eligible\r\n";
const example = "DEMO-001,Example Person,Example,person@example.invalid,active,2026-09-01,staff,,yes\r\n";

export function GET() {
  return new Response(header + example, { headers: {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": "attachment; filename=initial-staffing-template.csv",
    "cache-control": "no-store",
  } });
}
