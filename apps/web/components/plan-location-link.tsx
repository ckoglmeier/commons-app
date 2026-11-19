import { PinIcon } from "./icons";

export function PlanLocationLink({ location }: { location: string }) {
  let href = `https://maps.apple.com/?q=${encodeURIComponent(location)}`;
  try {
    const url = new URL(location.trim());
    if (url.protocol === "https:" || url.protocol === "http:") href = url.href;
  } catch {
    // Place names and addresses open the existing map search.
  }
  return <a className="plan-location-link" href={href} target="_blank" rel="noopener noreferrer"><PinIcon /><span>{location}</span></a>;
}
