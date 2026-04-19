import { useCallback, useEffect, useState } from "react";
import {
  archivePolicy,
  createPolicyRule,
  createProjectPolicy,
  createTenantPolicy,
  deletePolicy,
  deleteRule,
  fetchPolicies,
  fetchPolicyDetail,
  fetchPolicyProjects,
  fetchPolicyRuleViolationCounts,
  fetchRule,
  fetchTenantEntitlements,
  updatePolicy,
  updateRule,
} from "@/features/policies/api";
import type { Policy, Rule, ScopeFilter } from "@/features/policies/types";
import { getUserErrorMessage } from "@/lib/api-error";
import { SUPPORTED_ECOSYSTEMS } from "@/lib/ecosystems";
import type { RuleFormValues } from "@/components/policy/rule-form";

export function usePolicies({
  tenantId,
  scopeFilter,
}: {
  tenantId: string;
  scopeFilter: ScopeFilter;
}) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setPolicies(await fetchPolicies(tenantId, scopeFilter));
    } catch (err) {
      setPolicies([]);
      setError(getUserErrorMessage(err, "Failed to load policies"));
    } finally {
      setLoading(false);
    }
  }, [scopeFilter, tenantId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    policies,
    loading,
    error,
    setError,
    reload,
  };
}

export function usePolicyProjectNames(tenantId: string) {
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;

    fetchPolicyProjects(tenantId)
      .then((projects) => {
        if (!active) {
          return;
        }

        const nextProjectNames: Record<string, string> = {};
        for (const project of projects) {
          nextProjectNames[project.id] = project.name;
        }
        setProjectNames(nextProjectNames);
      })
      .catch(() => {
        if (active) {
          setProjectNames({});
        }
      });

    return () => {
      active = false;
    };
  }, [tenantId]);

  return projectNames;
}

export function usePolicyMutations({
  onSuccess,
  onError,
}: {
  onSuccess: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deletePolicy(id);
      await onSuccess();
    } catch (err) {
      onError(getUserErrorMessage(err, "Failed to delete policy"));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleArchive(id: string) {
    try {
      await archivePolicy(id);
      await onSuccess();
    } catch (err) {
      onError(getUserErrorMessage(err, "Failed to archive policy"));
    }
  }

  return {
    deletingId,
    handleDelete,
    handleArchive,
  };
}

export function usePolicyDetail(policyId: string | null) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [ruleViolationCounts, setRuleViolationCounts] = useState<
    Record<string, number>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!policyId) {
      setPolicy(null);
      setRules([]);
      setRuleViolationCounts({});
      setLoading(false);
      setError("Invalid policy identifier.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [policyData, countsData] = await Promise.all([
        fetchPolicyDetail(policyId),
        fetchPolicyRuleViolationCounts(policyId),
      ]);
      setPolicy(policyData.policy);
      setRules(policyData.policy.rules ?? []);
      setRuleViolationCounts(countsData.counts ?? {});
    } catch (err) {
      setPolicy(null);
      setRules([]);
      setRuleViolationCounts({});
      setError(getUserErrorMessage(err, "Failed to load policy"));
    } finally {
      setLoading(false);
    }
  }, [policyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    policy,
    rules,
    ruleViolationCounts,
    loading,
    error,
    setError,
    reload,
  };
}

export function usePolicyRuleFormEcosystems(tenantId: string) {
  const [ecosystems, setEcosystems] = useState<string[]>([
    ...SUPPORTED_ECOSYSTEMS,
  ]);

  useEffect(() => {
    let active = true;

    fetchTenantEntitlements(tenantId)
      .then((entitlements) => {
        if (active && entitlements.allowed_ecosystems) {
          setEcosystems(entitlements.allowed_ecosystems);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [tenantId]);

  return ecosystems;
}

export function useCreatePolicy(tenantId: string) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(input: {
    scope: "global" | "project";
    projectId: string;
    name: string;
    description: string;
    category: string;
    enforcementMode: "enforcing" | "advisory" | "disabled";
    priority: number;
    status: "active" | "draft";
  }) {
    setSaving(true);
    setError(null);

    try {
      if (input.scope === "project") {
        return await createProjectPolicy(input.projectId, {
          name: input.name.trim(),
          description: input.description.trim() || undefined,
          enforcement_mode: input.enforcementMode,
          priority: input.priority,
        });
      }

      return await createTenantPolicy(tenantId, {
        name: input.name.trim(),
        description: input.description.trim() || undefined,
        category: input.category.trim() || undefined,
        scope: "global",
        enforcement_mode: input.enforcementMode,
        priority: input.priority,
        status: input.status,
      });
    } catch (err) {
      setError(getUserErrorMessage(err, "Failed to create policy"));
      return null;
    } finally {
      setSaving(false);
    }
  }

  return { saving, error, setError, create };
}

export function usePolicyEditor(policyId: string) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function save(input: {
    name: string;
    description: string;
    enforcementMode: string;
    priority: number;
    status: string;
  }) {
    setSaving(true);
    setSaveError(null);
    try {
      await updatePolicy(policyId, {
        name: input.name.trim(),
        description: input.description.trim() || null,
        enforcement_mode: input.enforcementMode,
        priority: input.priority,
        status: input.status,
      });
      return true;
    } catch (err) {
      setSaveError(getUserErrorMessage(err, "Failed to save"));
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { saving, saveError, setSaveError, save };
}

export function usePolicyRuleMutations(
  policyId: string,
  onError: (message: string) => void,
) {
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);
  const [togglingRuleId, setTogglingRuleId] = useState<string | null>(null);

  async function removeRule(ruleId: string) {
    setDeletingRuleId(ruleId);
    try {
      await deleteRule(ruleId);
      return true;
    } catch (err) {
      onError(getUserErrorMessage(err, "Failed to delete rule"));
      return false;
    } finally {
      setDeletingRuleId(null);
    }
  }

  async function toggleRule(rule: Rule) {
    setTogglingRuleId(rule.id);
    try {
      await updateRule(rule.id, {
        name: rule.name,
        description: rule.description ?? null,
        target_entity: rule.target_entity,
        condition: rule.condition,
        action: rule.action,
        enabled: !rule.enabled,
      });
      return true;
    } catch {
      return false;
    } finally {
      setTogglingRuleId(null);
    }
  }

  async function createRuleForPolicy(values: RuleFormValues) {
    try {
      await createPolicyRule(policyId, {
        name: values.name.trim(),
        description: values.description.trim() || undefined,
        target_entity: values.targetEntity,
        condition: values.condition,
        action: values.action,
        enabled: values.enabled,
      });
      return { ok: true as const };
    } catch (err) {
      return {
        ok: false as const,
        error: getUserErrorMessage(err, "Failed to create rule"),
      };
    }
  }

  return {
    deletingRuleId,
    togglingRuleId,
    removeRule,
    toggleRule,
    createRuleForPolicy,
  };
}

export function useRuleEditor(ruleId: string | null) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<RuleFormValues | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!ruleId) {
      setLoadError("Invalid rule identifier.");
      setLoading(false);
      return;
    }

    fetchRule(ruleId)
      .then((data) => {
        const rule = data.rule;
        setValues({
          name: rule.name,
          description: rule.description ?? "",
          targetEntity: rule.target_entity,
          condition: rule.condition,
          action: rule.action,
          enabled: rule.enabled,
        });
      })
      .catch((err) =>
        setLoadError(getUserErrorMessage(err, "Failed to load rule")),
      )
      .finally(() => setLoading(false));
  }, [ruleId]);

  async function save(policyId: string, nextValues: RuleFormValues) {
    if (!policyId || !ruleId) {
      return false;
    }

    setSaving(true);
    setSaveError(null);
    try {
      await updateRule(ruleId, {
        name: nextValues.name.trim(),
        description: nextValues.description.trim() || null,
        target_entity: nextValues.targetEntity,
        condition: nextValues.condition,
        action: nextValues.action,
        enabled: nextValues.enabled,
      });
      return true;
    } catch (err) {
      setSaveError(getUserErrorMessage(err, "Failed to save rule"));
      return false;
    } finally {
      setSaving(false);
    }
  }

  return {
    loading,
    loadError,
    values,
    setValues,
    saving,
    saveError,
    save,
  };
}
