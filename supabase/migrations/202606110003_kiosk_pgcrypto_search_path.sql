alter function public.set_staff_kiosk_pin(text, text)
  set search_path = public, extensions;

alter function public.verify_kiosk_pin(text, text)
  set search_path = public, extensions;

alter function public.record_kiosk_clock_event(text, text, text, text)
  set search_path = public, extensions;
