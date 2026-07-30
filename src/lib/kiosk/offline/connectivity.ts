export type KioskConnectivity =
  | "online"
  | "offline"
  | "synchronising"
  | "sync_problem"
  | "authorisation_expired";

export function currentConnectivity(): "online" | "offline" {
  return navigator.onLine ? "online" : "offline";
}

export function subscribeToConnectivity(
  listener: (status: "online" | "offline") => void,
): () => void {
  const onOnline = () => listener("online");
  const onOffline = () => listener("offline");
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}
