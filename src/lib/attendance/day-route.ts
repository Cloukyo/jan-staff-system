export function attendanceDayHref(
  query: string | URLSearchParams,
  day: string,
  isOpen: boolean,
): string {
  const parameters = new URLSearchParams(query);
  if (isOpen) parameters.set("day", day);
  else if (parameters.get("day") === day) parameters.delete("day");
  return `/attendance?${parameters.toString()}`;
}

export function buildAttendanceDayReturnTo({
  staffId,
  from,
  to,
  day,
}: {
  staffId: string;
  from: string;
  to: string;
  day: string;
}): string {
  return attendanceDayHref(new URLSearchParams({
    view: "hours",
    hoursFrom: from,
    hoursTo: to,
    staffId,
  }), day, true);
}
