"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, Button, Input, Modal, ConfirmModal } from "@/shared/components";

export default function OrganizationsManagementPage() {
  const [authStatus, setAuthStatus] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  // Create Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "",
    plan_tier: "free",
    pay_as_you_go_ceiling: "0.00",
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState("");

  // Edit Modal State
  const [editingOrg, setEditingOrg] = useState(null);
  const [editForm, setEditForm] = useState({
    name: "",
    plan_tier: "free",
    pay_as_you_go_ceiling: "0.00",
  });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");

  // Confirmation Modal State (Suspend / Reinstate / Delete)
  const [confirmModal, setConfirmModal] = useState(null);

  // Members View Modal State
  const [membersOrg, setMembersOrg] = useState(null);
  const [membersList, setMembersList] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberRole, setNewMemberRole] = useState("member");
  const [addMemberLoading, setAddMemberLoading] = useState(false);
  const [addMemberError, setAddMemberError] = useState("");

  const fetchAuth = async () => {
    try {
      const res = await fetch("/api/auth/status", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setAuthStatus(data);
      }
    } catch (err) {
      console.error("Failed to check auth status:", err);
    }
  };

  const fetchOrgs = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/orgs", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setOrgs(data.organizations || []);
      }
    } catch (err) {
      console.error("Failed to fetch organizations:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuth();
    fetchOrgs();
  }, []);

  const filteredOrgs = useMemo(() => {
    return orgs.filter((org) => {
      const matchesSearch =
        org.name.toLowerCase().includes(search.toLowerCase()) ||
        org.id.toLowerCase().includes(search.toLowerCase());
      const matchesStatus =
        statusFilter === "all" || org.status === statusFilter;
      const matchesType =
        typeFilter === "all" ||
        (typeFilter === "personal"
          ? org.type === "personal_auto"
          : org.type !== "personal_auto");
      return matchesSearch && matchesStatus && matchesType;
    });
  }, [orgs, search, statusFilter, typeFilter]);

  const handleCreateOrg = async (e) => {
    e.preventDefault();
    if (!createForm.name.trim()) return;
    setCreateLoading(true);
    setCreateError("");

    try {
      const res = await fetch("/api/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createForm.name.trim(),
          plan_tier: createForm.plan_tier,
          pay_as_you_go_ceiling: parseFloat(createForm.pay_as_you_go_ceiling) || 0,
        }),
      });

      if (res.ok) {
        setShowCreateModal(false);
        setCreateForm({ name: "", plan_tier: "free", pay_as_you_go_ceiling: "0.00" });
        await fetchOrgs();
      } else {
        const data = await res.json();
        setCreateError(data.error || "Failed to create organization");
      }
    } catch (err) {
      setCreateError("An unexpected error occurred");
    } finally {
      setCreateLoading(false);
    }
  };

  const handleOpenEdit = (org) => {
    setEditingOrg(org);
    setEditForm({
      name: org.name,
      plan_tier: org.plan_tier || "free",
      pay_as_you_go_ceiling: String(org.pay_as_you_go_ceiling || 0),
    });
    setEditError("");
  };

  const handleUpdateOrg = async (e) => {
    e.preventDefault();
    if (!editingOrg) return;
    setEditLoading(true);
    setEditError("");

    try {
      const res = await fetch(`/api/orgs/${editingOrg.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name.trim(),
          plan_tier: editForm.plan_tier,
          pay_as_you_go_ceiling: parseFloat(editForm.pay_as_you_go_ceiling) || 0,
        }),
      });

      if (res.ok) {
        setEditingOrg(null);
        await fetchOrgs();
      } else {
        const data = await res.json();
        setEditError(data.error || "Failed to update organization");
      }
    } catch {
      setEditError("An unexpected error occurred");
    } finally {
      setEditLoading(false);
    }
  };

  const handleToggleStatus = (org) => {
    const nextStatus = org.status === "active" ? "suspended" : "active";
    setConfirmModal({
      title: `${nextStatus === "suspended" ? "Suspend" : "Reinstate"} Organization`,
      message: `Are you sure you want to ${nextStatus === "suspended" ? "suspend" : "reinstate"} "${org.name}"? ${
        nextStatus === "suspended"
          ? "Members of this organization will temporarily lose access to their shared provider pool and routing."
          : "Access to routing and credential pools will be restored."
      }`,
      confirmText: nextStatus === "suspended" ? "Suspend Organization" : "Reinstate",
      confirmVariant: nextStatus === "suspended" ? "danger" : "primary",
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/orgs/${org.id}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: nextStatus }),
          });
          if (res.ok) {
            await fetchOrgs();
          }
        } catch (err) {
          console.error("Failed to update status:", err);
        }
      },
    });
  };

  const handleDeleteOrg = (org) => {
    setConfirmModal({
      title: "Delete Organization",
      message: `Permanently delete organization "${org.name}"?\n\nThis will remove all memberships, invitations, and org-scoped connections associated with this organization. This action cannot be undone.`,
      confirmText: "Delete Permanently",
      confirmVariant: "danger",
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/orgs/${org.id}`, {
            method: "DELETE",
          });
          if (res.ok) {
            await fetchOrgs();
          }
        } catch (err) {
          console.error("Failed to delete organization:", err);
        }
      },
    });
  };

  const handleOpenMembers = async (org) => {
    setMembersOrg(org);
    setMembersLoading(true);
    setAddMemberError("");
    setNewMemberEmail("");
    try {
      const res = await fetch(`/api/orgs/${org.id}/members`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setMembersList(data.members || []);
      }
    } catch (err) {
      console.error("Failed to fetch members:", err);
    } finally {
      setMembersLoading(false);
    }
  };

  const handleAddMember = async (e) => {
    e.preventDefault();
    if (!newMemberEmail.trim() || !membersOrg) return;
    setAddMemberLoading(true);
    setAddMemberError("");

    try {
      const res = await fetch(`/api/orgs/${membersOrg.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newMemberEmail.trim(),
          role: newMemberRole,
        }),
      });

      if (res.ok) {
        setNewMemberEmail("");
        // Refresh members
        const mRes = await fetch(`/api/orgs/${membersOrg.id}/members`, { cache: "no-store" });
        if (mRes.ok) {
          const mData = await mRes.json();
          setMembersList(mData.members || []);
        }
      } else {
        const data = await res.json();
        setAddMemberError(data.error || "Failed to add member");
      }
    } catch {
      setAddMemberError("Failed to add member");
    } finally {
      setAddMemberLoading(false);
    }
  };

  const handleRemoveMember = async (userId) => {
    if (!membersOrg) return;
    try {
      const res = await fetch(`/api/orgs/${membersOrg.id}/members/${userId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setMembersList((prev) => prev.filter((m) => m.userId !== userId));
      }
    } catch (err) {
      console.error("Failed to remove member:", err);
    }
  };

  if (!authStatus?.isSuperadmin && !loading) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card className="text-center py-12">
          <div className="inline-flex items-center justify-center size-16 rounded-full bg-red-500/10 text-red-500 mb-4">
            <span className="material-symbols-outlined text-[32px]">shield</span>
          </div>
          <h1 className="text-xl font-bold mb-2">Access Denied</h1>
          <p className="text-sm text-text-muted max-w-md mx-auto mb-6">
            Organization management and platform operations are restricted to platform Superadmins.
          </p>
          <Button href="/dashboard" variant="primary">
            Return to Dashboard
          </Button>
        </Card>
      </div>
    );
  }

  const totalCeiling = orgs.reduce((acc, o) => acc + (o.pay_as_you_go_ceiling || 0), 0);
  const activeCount = orgs.filter((o) => o.status === "active").length;
  const suspendedCount = orgs.filter((o) => o.status === "suspended").length;

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-text-main flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-[28px]">corporate_fare</span>
              Organizations & Tenants
            </h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
              Superadmin Only
            </span>
          </div>
          <p className="text-sm text-text-muted mt-1">
            Browse and manage all tenant organizations, plan tiers, and cost ceilings across the platform.
          </p>
        </div>

        <Button icon="add" variant="primary" onClick={() => setShowCreateModal(true)}>
          Create Organization
        </Button>
      </div>

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4 flex flex-col justify-between">
          <span className="text-xs font-medium text-text-muted">Total Organizations</span>
          <span className="text-2xl font-bold text-text-main mt-2">{orgs.length}</span>
        </Card>
        <Card className="p-4 flex flex-col justify-between">
          <span className="text-xs font-medium text-text-muted">Active Tenants</span>
          <span className="text-2xl font-bold text-green-600 dark:text-green-400 mt-2">{activeCount}</span>
        </Card>
        <Card className="p-4 flex flex-col justify-between">
          <span className="text-xs font-medium text-text-muted">Suspended</span>
          <span className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-2">{suspendedCount}</span>
        </Card>
        <Card className="p-4 flex flex-col justify-between">
          <span className="text-xs font-medium text-text-muted">Total PAYG Ceiling</span>
          <span className="text-2xl font-bold text-primary mt-2">${totalCeiling.toFixed(2)}</span>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <span className="material-symbols-outlined absolute left-3 top-2.5 text-text-muted text-[18px]">
              search
            </span>
            <input
              type="text"
              placeholder="Search organizations by name or ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg border border-border bg-surface text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-border bg-surface text-xs font-medium text-text-main"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Only</option>
              <option value="suspended">Suspended Only</option>
            </select>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-border bg-surface text-xs font-medium text-text-main"
            >
              <option value="all">All Types</option>
              <option value="standard">Team / Standard</option>
              <option value="personal">Personal Workspaces</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Organizations Table */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-subtle border-b border-border text-xs text-text-muted uppercase">
              <tr>
                <th className="px-6 py-3">Organization</th>
                <th className="px-6 py-3">Type</th>
                <th className="px-6 py-3">Plan Tier</th>
                <th className="px-6 py-3">PAYG Ceiling</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Created</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan="7" className="px-6 py-8 text-center text-text-muted">
                    Loading organizations...
                  </td>
                </tr>
              ) : filteredOrgs.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center text-text-muted">
                    No organizations match your search or filter.
                  </td>
                </tr>
              ) : (
                filteredOrgs.map((org) => {
                  const isPersonal = org.type === "personal_auto";
                  const isSuspended = org.status === "suspended";

                  return (
                    <tr
                      key={org.id}
                      className={`hover:bg-surface-subtle transition-colors ${
                        isSuspended ? "opacity-60 bg-amber-500/[0.02]" : ""
                      }`}
                    >
                      <td className="px-6 py-4">
                        <div className="font-semibold text-text-main flex items-center gap-2">
                          <span className="material-symbols-outlined text-primary text-[18px]">
                            {isPersonal ? "account_circle" : "domain"}
                          </span>
                          <span>{org.name}</span>
                        </div>
                        <div className="text-xs text-text-muted font-mono mt-0.5 truncate max-w-[220px]">
                          {org.id}
                        </div>
                      </td>

                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${
                            isPersonal
                              ? "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20"
                              : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                          }`}
                        >
                          {isPersonal ? "Personal" : "Team / Standard"}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
                          {org.plan_tier || "free"}
                        </span>
                      </td>

                      <td className="px-6 py-4 font-mono font-medium">
                        ${Number(org.pay_as_you_go_ceiling || 0).toFixed(2)}
                      </td>

                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                            isSuspended
                              ? "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20"
                              : "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20"
                          }`}
                        >
                          <span
                            className={`size-1.5 rounded-full ${
                              isSuspended ? "bg-red-500" : "bg-green-500"
                            }`}
                          />
                          {isSuspended ? "Suspended" : "Active"}
                        </span>
                      </td>

                      <td className="px-6 py-4 text-xs text-text-muted whitespace-nowrap">
                        {new Date(org.created_at).toLocaleDateString()}
                      </td>

                      <td className="px-6 py-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleOpenMembers(org)}
                            className="p-1.5 rounded hover:bg-surface-2 text-text-muted hover:text-primary transition-colors"
                            title="Manage members"
                          >
                            <span className="material-symbols-outlined text-[18px]">group</span>
                          </button>

                          <button
                            onClick={() => handleOpenEdit(org)}
                            className="p-1.5 rounded hover:bg-surface-2 text-text-muted hover:text-primary transition-colors"
                            title="Edit organization"
                          >
                            <span className="material-symbols-outlined text-[18px]">edit</span>
                          </button>

                          <button
                            onClick={() => handleToggleStatus(org)}
                            className={`p-1.5 rounded hover:bg-surface-2 transition-colors ${
                              isSuspended ? "text-green-600 hover:text-green-700" : "text-amber-500 hover:text-amber-600"
                            }`}
                            title={isSuspended ? "Reinstate organization" : "Suspend organization"}
                          >
                            <span className="material-symbols-outlined text-[18px]">
                              {isSuspended ? "play_circle" : "pause_circle"}
                            </span>
                          </button>

                          <button
                            onClick={() => handleDeleteOrg(org)}
                            className="p-1.5 rounded hover:bg-red-500/10 text-red-500 transition-colors"
                            title="Delete organization"
                          >
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Create Organization Modal */}
      <Modal
        isOpen={showCreateModal}
        title="Create New Organization"
        onClose={() => setShowCreateModal(false)}
      >
        <form onSubmit={handleCreateOrg} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-muted">Organization Name *</label>
            <Input
              type="text"
              placeholder="e.g. Acme Corporation"
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              required
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-muted">Plan Tier</label>
            <select
              value={createForm.plan_tier}
              onChange={(e) => setCreateForm({ ...createForm, plan_tier: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm text-text-main"
            >
              <option value="free">Free</option>
              <option value="standard">Standard</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-muted">Pay-as-you-go Cost Ceiling ($ / month)</label>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={createForm.pay_as_you_go_ceiling}
              onChange={(e) =>
                setCreateForm({ ...createForm, pay_as_you_go_ceiling: e.target.value })
              }
            />
            <p className="text-[11px] text-text-muted">
              Monthly spend ceiling for fallback models in Tier 3 (OpenRouter/DeepSeek). Set to 0 to disable pay-as-you-go pool.
            </p>
          </div>

          {createError && <p className="text-xs text-red-500">{createError}</p>}

          <div className="flex gap-2 justify-end mt-2">
            <Button type="button" variant="ghost" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={createLoading} disabled={!createForm.name.trim()}>
              Create Organization
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Organization Modal */}
      <Modal
        isOpen={!!editingOrg}
        title="Edit Organization Settings"
        onClose={() => setEditingOrg(null)}
      >
        <form onSubmit={handleUpdateOrg} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-muted">Organization Name *</label>
            <Input
              type="text"
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-muted">Plan Tier</label>
            <select
              value={editForm.plan_tier}
              onChange={(e) => setEditForm({ ...editForm, plan_tier: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm text-text-main"
            >
              <option value="free">Free</option>
              <option value="standard">Standard</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-muted">Pay-as-you-go Cost Ceiling ($)</label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={editForm.pay_as_you_go_ceiling}
              onChange={(e) => setEditForm({ ...editForm, pay_as_you_go_ceiling: e.target.value })}
            />
          </div>

          {editError && <p className="text-xs text-red-500">{editError}</p>}

          <div className="flex gap-2 justify-end mt-2">
            <Button type="button" variant="ghost" onClick={() => setEditingOrg(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={editLoading}>
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>

      {/* Manage Members Modal */}
      <Modal
        isOpen={!!membersOrg}
        title={`Members — ${membersOrg?.name || ""}`}
        onClose={() => setMembersOrg(null)}
      >
        <div className="flex flex-col gap-4">
          {/* Add member form */}
          <form onSubmit={handleAddMember} className="flex gap-2">
            <div className="flex-1">
              <Input
                type="email"
                placeholder="User email address..."
                value={newMemberEmail}
                onChange={(e) => setNewMemberEmail(e.target.value)}
                required
              />
            </div>
            <select
              value={newMemberRole}
              onChange={(e) => setNewMemberRole(e.target.value)}
              className="px-3 py-2 rounded-lg border border-border bg-surface text-sm text-text-main"
            >
              <option value="member">Member</option>
              <option value="org_admin">Org Admin</option>
            </select>
            <Button type="submit" variant="primary" loading={addMemberLoading}>
              Add
            </Button>
          </form>

          {addMemberError && <p className="text-xs text-red-500">{addMemberError}</p>}

          {/* Members list */}
          <div className="border border-border rounded-lg divide-y divide-border max-h-60 overflow-y-auto">
            {membersLoading ? (
              <div className="p-4 text-center text-xs text-text-muted">Loading members...</div>
            ) : membersList.length === 0 ? (
              <div className="p-4 text-center text-xs text-text-muted">No members yet.</div>
            ) : (
              membersList.map((m) => (
                <div key={m.userId} className="flex items-center justify-between p-3">
                  <div>
                    <p className="text-sm font-medium">{m.userDisplayName || m.userEmail}</p>
                    <p className="text-xs text-text-muted font-mono">{m.userEmail}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${
                        m.role === "org_admin"
                          ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
                          : "bg-surface-2 text-text-muted"
                      }`}
                    >
                      {m.role}
                    </span>
                    <button
                      onClick={() => handleRemoveMember(m.userId)}
                      className="p-1 hover:bg-red-500/10 rounded text-red-500 transition-colors"
                      title="Remove member"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>

      {/* Confirmation Modal */}
      {confirmModal && (
        <ConfirmModal
          isOpen={true}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmText={confirmModal.confirmText}
          confirmVariant={confirmModal.confirmVariant}
          onConfirm={async () => {
            await confirmModal.onConfirm();
            setConfirmModal(null);
          }}
          onClose={() => setConfirmModal(null)}
        />
      )}
    </div>
  );
}
