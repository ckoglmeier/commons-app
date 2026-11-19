"use client";

export async function shareStayAddress(name: string, address: string, actions: {
  share?: (data: ShareData) => Promise<void>;
  copy: (address: string) => void | Promise<void>;
}) {
  if (actions.share) {
    try {
      await actions.share({ title: name, text: `${name}\n${address}` });
      return;
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return;
    }
  }
  await actions.copy(address);
}

export function StayAddressActions({ name, address, copy }: {
  name: string; address: string; copy: (address: string) => void | Promise<void>;
}) {
  return <div className="stay-address-actions" role="group" aria-label={`Address actions for ${name}`}>
    <button type="button" onClick={() => void copy(address)}>Copy address</button>
    <button type="button" onClick={() => void shareStayAddress(name, address, { share: navigator.share?.bind(navigator), copy })}>Share address</button>
    <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer">Google Maps</a>
  </div>;
}
