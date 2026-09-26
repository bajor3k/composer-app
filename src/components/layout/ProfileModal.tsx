"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface ProfileData {
  photo: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

// Matches the demo identity in src/lib/auth.ts ("Demo User").
const DEFAULT_PROFILE: ProfileData = {
  photo: "",
  firstName: "Demo",
  lastName: "User",
  email: "demo.advisor@example.com",
  phone: "",
};

export default function ProfileModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [profile, setProfile] = useState<ProfileData>(DEFAULT_PROFILE);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    try {
      const saved = localStorage.getItem("composer-profile");
      setProfile(saved ? { ...DEFAULT_PROFILE, ...JSON.parse(saved) } : DEFAULT_PROFILE);
    } catch {
      setProfile(DEFAULT_PROFILE);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const update = (field: keyof ProfileData, value: string) =>
    setProfile((prev) => ({ ...prev, [field]: value }));

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => update("photo", reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleSave = () => {
    try {
      localStorage.setItem("composer-profile", JSON.stringify(profile));
      window.dispatchEvent(new Event("composer-profile-updated"));
    } catch { /* ignore */ }
    onClose();
  };

  const initials = `${profile.firstName?.[0] ?? ""}${profile.lastName?.[0] ?? ""}`.toUpperCase();

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center pt-[8vh] px-4 bg-black/40 dark:bg-black/60 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white dark:bg-zinc-900 medium:bg-[#c8c8c8] rounded-2xl shadow-2xl border border-black/10 dark:border-white/10 overflow-hidden mb-12"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5 dark:border-white/5">
          <span className="text-base font-semibold text-black dark:text-white">Profile</span>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-5">
          {/* Photo */}
          <div className="flex items-center gap-4 mb-6">
            <div className="w-16 h-16 rounded-full bg-foreground flex items-center justify-center flex-shrink-0 overflow-hidden">
              {profile.photo ? (
                <img src={profile.photo} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <span className="text-background text-xl font-medium">{initials}</span>
              )}
            </div>
            <div>
              <div className="text-sm text-black dark:text-white font-medium mb-1.5">Contact Photo</div>
              <div className="flex gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3.5 py-1.5 text-xs text-black dark:text-white border border-border dark:border-border-dark rounded-lg hover:bg-surface dark:hover:bg-surface-dark transition-colors"
                >
                  Upload
                </button>
                {profile.photo && (
                  <button
                    onClick={() => update("photo", "")}
                    className="px-3.5 py-1.5 text-xs text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <Field label="First Name" value={profile.firstName} onChange={(v) => update("firstName", v)} />
            <Field label="Last Name" value={profile.lastName} onChange={(v) => update("lastName", v)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Email" value={profile.email} onChange={(v) => update("email", v)} />
            <Field label="Phone" value={profile.phone} onChange={(v) => update("phone", v)} placeholder="(555) 000-0000" />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-black/5 dark:border-white/5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-black text-white dark:bg-white dark:text-black hover:opacity-90 transition-opacity"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40 mb-1.5">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-border dark:border-border-dark bg-surface dark:bg-surface-dark text-sm text-black dark:text-white placeholder-black/30 dark:placeholder-white/30 outline-none focus:border-black dark:focus:border-white transition-colors"
      />
    </div>
  );
}
