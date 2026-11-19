'use client';
import { useState } from 'react';
import { CoordinatorSettingsSchema, coordinatorPersonalities, type CoordinatorPersonalityId } from '@commons/contracts';
import { CoordinatorPersonalityPicker } from './coordinator-personality-picker';
export function TripCoordinatorSettings({ slug, initial, onChange, showCurrent = true }: {
    slug: string;
    initial: {
        version: number;
        personality: {
            id: CoordinatorPersonalityId;
            specificationVersion: 1;
        };
    };
    onChange?: (id: CoordinatorPersonalityId) => void;
    showCurrent?: boolean;
}) {
    const [settings, setSettings] = useState(initial);
    return <>{showCurrent && <span className="review-caption">Current style: {coordinatorPersonalities.find(person => person.id === settings.personality.id)!.name}</span>}<CoordinatorPersonalityPicker value={settings.personality.id} onChoose={async (id) => {
            const response = await fetch(`/api/v1/commons/${slug}/coordinator/settings`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'personality', commandId: crypto.randomUUID(), expectedVersion: settings.version, personality: { id, specificationVersion: 1 } }) });
            const payload = await response.json();
            if (!response.ok) {
                if (response.status === 409) {
                    const fresh = await fetch(`/api/v1/commons/${slug}/coordinator/settings`, { cache: 'no-store' });
                    if (fresh.ok) {
                        const latest = CoordinatorSettingsSchema.parse((await fresh.json()).settings);
                        setSettings(latest);
                        onChange?.(latest.personality.id);
                    }
                }
                throw new Error(payload.error ?? 'Could not save.');
            }
            const next = CoordinatorSettingsSchema.parse(payload.settings);
            setSettings(next);
            onChange?.(next.personality.id);
        }}/></>;
}
