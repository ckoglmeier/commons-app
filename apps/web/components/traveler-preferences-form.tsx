"use client";

import { useState } from "react";
import type { TravelerProfile } from "@commons/contracts";

type PreferenceKey = "usualOriginLabel" | "dietaryPreferences" | "accessibilityNeeds" | "lodgingPreferences" | "transportationPreferences";

const fields: Array<{ key: PreferenceKey; label: string; placeholder: string; singleLine?: boolean }> = [
  { key: "usualOriginLabel", label: "Usual starting point", placeholder: "Denver or DEN", singleLine: true },
  { key: "dietaryPreferences", label: "Food and dietary needs", placeholder: "Allergies, restrictions, or foods to avoid" },
  { key: "accessibilityNeeds", label: "Accessibility needs", placeholder: "Mobility, sensory, or other support that helps" },
  { key: "lodgingPreferences", label: "Lodging preferences", placeholder: "Room setup, sleeping needs, or location preferences" },
  { key: "transportationPreferences", label: "Transportation preferences", placeholder: "Car seats, rail preference, driving limits, or other needs" },
];

export function TravelerPreferencesForm({ profile, endpoint, managed = false }: { profile: TravelerProfile; endpoint: string; managed?: boolean }) {
  const valuesFrom = (value: TravelerProfile) => Object.fromEntries(fields.map((field) => [field.key, value[field.key] ?? ""])) as Record<PreferenceKey, string>;
  const [values, setValues] = useState(() => valuesFrom(profile));
  const [savedValues, setSavedValues] = useState(() => valuesFrom(profile));
  const [attribution, setAttribution] = useState(profile.suppliedBy);
  const [sharedKeys, setSharedKeys] = useState<PreferenceKey[]>(() => (profile.sharedPreferenceKeys ?? []) as PreferenceKey[]);
  const [savedSharedKeys, setSavedSharedKeys] = useState<PreferenceKey[]>(() => (profile.sharedPreferenceKeys ?? []) as PreferenceKey[]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const sharingAvailable = profile.sharedPreferenceKeys !== undefined;
  const changed = fields.some((field) => values[field.key].trim() !== savedValues[field.key])
    || sharedKeys.join("|") !== savedSharedKeys.join("|");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const body = { ...Object.fromEntries(fields.map((field) => [field.key, values[field.key].trim() || null])), ...(sharingAvailable ? { sharedPreferenceKeys: sharedKeys } : {}) };
      const response = await fetch(endpoint, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Travel details not saved.");
      const next = valuesFrom(payload as TravelerProfile);
      setValues(next);
      setSavedValues(next);
      setAttribution((payload as TravelerProfile).suppliedBy);
      setSharedKeys(((payload as TravelerProfile).sharedPreferenceKeys ?? []) as PreferenceKey[]);
      setSavedSharedKeys(((payload as TravelerProfile).sharedPreferenceKeys ?? []) as PreferenceKey[]);
      setMessage(sharingAvailable ? "Travel details and trip sharing updated." : "Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Travel details not saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={`traveler-preferences${managed ? " traveler-preferences--managed" : ""}`} onSubmit={save}>
      <div className="traveler-preferences__heading">
        <span className="view-kicker">Travel profile · Optional</span>
        <h2>{managed ? `${profile.displayName}’s travel details` : "Your travel preferences"}</h2>
        <p>{managed
          ? `Private to ${profile.displayName}’s assigned managers and Commons. Nothing is shared with a trip automatically.`
          : "Only you and Commons can see these. We’ll ask before using or sharing them for a trip."}</p>
      </div>
      <div className="traveler-preferences__fields">
        {fields.map((field) => {
          const suppliedBy = attribution[field.key];
          return (
            <label className="field" key={field.key}>
              <span>{field.label}</span>
              {field.singleLine ? (
                <input value={values[field.key]} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} placeholder={field.placeholder} maxLength={field.key === "usualOriginLabel" ? 160 : 500} />
              ) : (
                <textarea value={values[field.key]} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} placeholder={field.placeholder} maxLength={500} rows={2} />
              )}
              {suppliedBy && savedValues[field.key] ? <small>Last updated by {suppliedBy.displayName}.</small> : null}
            </label>
          );
        })}
      </div>
      {sharingAvailable ? <fieldset className="traveler-preferences__sharing"><legend>Share with this trip</legend><p>Nothing is shared unless you select it.</p>{fields.filter((field) => values[field.key].trim()).map((field) => <label key={field.key}><input type="checkbox" checked={sharedKeys.includes(field.key)} onChange={() => setSharedKeys((current) => current.includes(field.key) ? current.filter((key) => key !== field.key) : [...current, field.key])} /><span>{field.label}</span></label>)}</fieldset> : null}
      <div className="traveler-preferences__actions"><button type="submit" disabled={pending || !changed}>{pending ? "Saving…" : "Save travel details"}</button></div>
      {message ? <small className="traveler-preferences__message" role="status">{message}</small> : null}
    </form>
  );
}
