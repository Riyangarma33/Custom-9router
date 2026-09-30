"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import Modal from "./Modal";
import Button from "./Button";
import Input from "./Input";

export default function OrgSwitcher({
  organizations = [],
  activeOrgId,
  isSuperadmin = false,
  role = "member",
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState("");
  const dropdownRef = useRef(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const activeOrg = organizations.find((o) => o.id === activeOrgId) || organizations[0];

  const handleSwitch = async (newOrgId) => {
    if (newOrgId === activeOrgId) {
      setIsOpen(false);
      return;
    }
    try {
      const res = await fetch("/api/auth/org/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: newOrgId }),
      });
      if (res.ok) {
        window.location.reload();
      }
    } catch (err) {
      console.error("Failed to switch organization:", err);
    }
  };

  const handleJoinOrg = async (e) => {
    e.preventDefault();
    if (!inviteCode.trim()) return;
    setJoinLoading(true);
    setJoinError("");

    try {
      const res = await fetch("/api/orgs/invitations/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: inviteCode.trim() }),
      });

      if (res.ok) {
        setJoinModalOpen(false);
        setInviteCode("");
        window.location.reload();
      } else {
        const data = await res.json();
        setJoinError(data.error || "Failed to redeem invitation");
      }
    } catch {
      setJoinError("An unexpected error occurred");
    } finally {
      setJoinLoading(false);
    }
  };

  if (isSuperadmin) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-purple-500/30 bg-purple-500/10 text-xs font-semibold text-purple-600 dark:text-purple-400">
        <span className="material-symbols-outlined text-[16px]">shield_person</span>
        <span>Superadmin</span>
      </div>
    );
  }

  if (organizations.length === 0) {
    return null;
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-surface/80 hover:bg-surface transition-all text-xs font-medium text-text-main shadow-xs cursor-pointer group"
      >
        <span className="material-symbols-outlined text-primary text-[16px] group-hover:scale-105 transition-transform">
          {activeOrg?.type === "personal_auto" ? "account_circle" : "domain"}
        </span>
        <span className="font-semibold truncate max-w-[130px] sm:max-w-[180px]">
          {activeOrg?.name || "Workspace"}
        </span>
        <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-surface-subtle text-text-muted border border-border/40">
          {role}
        </span>
        <span className="material-symbols-outlined text-text-muted text-[16px] transition-transform" style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}>
          expand_more
        </span>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 rounded-xl border border-border bg-surface/95 backdrop-blur-xl shadow-xl z-50 p-2 flex flex-col gap-1">
          <div className="px-3 py-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
            Organizations & Workspaces
          </div>

          <div className="flex flex-col gap-0.5 max-h-56 overflow-y-auto">
            {organizations.map((org) => {
              const isSelected = org.id === activeOrgId;
              const isPersonal = org.type === "personal_auto";

              return (
                <button
                  key={org.id}
                  type="button"
                  onClick={() => handleSwitch(org.id)}
                  className={`flex items-center justify-between w-full px-3 py-2 rounded-lg text-left text-xs transition-colors ${
                    isSelected
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-text-main hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="material-symbols-outlined text-[16px] shrink-0">
                      {isPersonal ? "account_circle" : "domain"}
                    </span>
                    <div className="truncate">
                      <p className="truncate font-medium">{org.name}</p>
                      <p className="text-[10px] text-text-muted uppercase font-mono">{org.role}</p>
                    </div>
                  </div>

                  {isSelected && (
                    <span className="material-symbols-outlined text-[16px] text-primary shrink-0">
                      check
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="h-px bg-border my-1" />

          {/* Join Organization Button */}
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              setJoinModalOpen(true);
            }}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">group_add</span>
            <span>Join with Invitation Code</span>
          </button>
        </div>
      )}

      {/* Join Organization Modal */}
      <Modal
        isOpen={joinModalOpen}
        title="Join an Organization"
        onClose={() => setJoinModalOpen(false)}
      >
        <form onSubmit={handleJoinOrg} className="flex flex-col gap-4">
          <p className="text-xs text-text-muted">
            Enter the invitation code provided by your organization admin to join their team.
          </p>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-muted">Invitation Code *</label>
            <Input
              type="text"
              placeholder="Paste invitation code here"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              required
              autoFocus
            />
          </div>

          {joinError && <p className="text-xs text-red-500">{joinError}</p>}

          <div className="flex justify-end gap-2 mt-2">
            <Button type="button" variant="ghost" onClick={() => setJoinModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={joinLoading} disabled={!inviteCode.trim()}>
              Join Organization
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

OrgSwitcher.propTypes = {
  organizations: PropTypes.array,
  activeOrgId: PropTypes.string,
  isSuperadmin: PropTypes.bool,
  role: PropTypes.string,
};
