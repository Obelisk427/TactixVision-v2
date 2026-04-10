import { useState, useEffect } from 'react';
import type { PugVettingMetrics, RaiderIOBestRun, Region } from '../types';
import { fetchRunMetrics } from '../services/warcraftLogs';

export type CharacterRole = 'DPS' | 'HEALER' | 'TANK';

interface PugVettingModalProps {
  run: RaiderIOBestRun;
  characterName: string;
  realm: string;
  region: Region;
  /** Role detected from Raider.io active_spec_role */
  role: CharacterRole;
  /** Active spec name, e.g. "Assassination" */
  specName: string;
  /** Class name, e.g. "Rogue" */
  className: string;
  onClose: () => void;
}

function formatClearTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  return `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`;
}

function formatDps(dps: number): string {
  if (dps >= 1_000_000) return `${(dps / 1_000_000).toFixed(1)}M`;
  if (dps >= 1_000) return `${(dps / 1_000).toFixed(1)}K`;
  return dps.toString();
}

function formatHps(hps: number): string {
  if (hps >= 1_000_000) return `${(hps / 1_000_000).toFixed(1)}M`;
  if (hps >= 1_000) return `${(hps / 1_000).toFixed(1)}K`;
  return hps.toString();
}

/** Color + label for a WCL parse percentile. */
function getParseInfo(pct: number | null): { color: string; label: string; tier: string } {
  if (pct === null) return { color: 'text-slate-500', label: 'N/A', tier: '' };
  if (pct >= 99) return { color: 'text-amber-400', label: `${pct.toFixed(0)}%`, tier: 'Legendary' };
  if (pct >= 95) return { color: 'text-orange-400', label: `${pct.toFixed(0)}%`, tier: 'Epic' };
  if (pct >= 75) return { color: 'text-purple-400', label: `${pct.toFixed(0)}%`, tier: 'Rare' };
  if (pct >= 50) return { color: 'text-blue-400', label: `${pct.toFixed(0)}%`, tier: 'Uncommon' };
  if (pct >= 25) return { color: 'text-green-400', label: `${pct.toFixed(0)}%`, tier: 'Common' };
  return { color: 'text-slate-500', label: `${pct.toFixed(0)}%`, tier: 'Poor' };
}

function formatDamageRaw(dmg: number): string {
  if (dmg >= 1_000_000) return `${(dmg / 1_000_000).toFixed(1)}M`;
  if (dmg >= 1_000) return `${(dmg / 1_000).toFixed(0)}K`;
  return dmg.toString();
}

/** Returns color class and label for the relative damage metric. */
function getDamageContext(percent: number | null, isTank: boolean): { color: string; label: string } {
  if (percent === null) return { color: 'text-slate-500', label: 'N/A' };

  if (isTank) {
    // Tank: showing % of group damage. 35-55% is normal.
    return { color: 'text-blue-400', label: `${percent}% of group` };
  }

  // Non-tank: positive = above avg (bad), negative = below avg (good)
  if (percent <= -15) return { color: 'text-green-400', label: `${percent}% vs avg` };
  if (percent <= 5) return { color: 'text-slate-300', label: `${percent > 0 ? '+' : ''}${percent}% vs avg` };
  if (percent <= 20) return { color: 'text-orange-400', label: `+${percent}% vs avg` };
  return { color: 'text-red-400', label: `+${percent}% vs avg` };
}

/** Pulsing placeholder shown while loading */
function MetricSkeleton() {
  return (
    <div className="h-8 w-16 rounded-md bg-white/[0.06] animate-pulse mx-auto" />
  );
}

/* ─── Role-specific verdict generation ─────────────────────────────────── */

interface VerdictLine {
  icon: string;
  text: string;
  tone: 'good' | 'warn' | 'bad' | 'info';
}

const TONE_COLORS: Record<VerdictLine['tone'], string> = {
  good: 'text-green-400',
  warn: 'text-orange-400',
  bad: 'text-red-400',
  info: 'text-slate-400',
};

function buildVerdict(
  metrics: PugVettingMetrics,
  role: CharacterRole,
): VerdictLine[] {
  const lines: VerdictLine[] = [];

  /* ── Deaths (universal) ─────────────────────────────────────────── */
  const deaths = metrics.deaths ?? 0;
  if (deaths === 0) {
    lines.push({ icon: '✅', text: 'Zero deaths — clean run.', tone: 'good' });
  } else if (deaths <= 1) {
    lines.push({ icon: '⚠️', text: `${deaths} death. Not ideal, but recoverable.`, tone: 'warn' });
  } else {
    lines.push({ icon: '💀', text: `${deaths} deaths — that\'s a lot of floor time.`, tone: 'bad' });
  }

  /* ── Interrupts (universal, weighted by role) ───────────────────── */
  const kicks = metrics.interrupts ?? 0;
  if (role === 'TANK') {
    if (kicks >= 8) lines.push({ icon: '⚡', text: `${kicks} interrupts — great kick discipline for a tank.`, tone: 'good' });
    else if (kicks >= 4) lines.push({ icon: '⚡', text: `${kicks} interrupts. Decent, but tanks should aim higher.`, tone: 'warn' });
    else lines.push({ icon: '⚡', text: `Only ${kicks} interrupts. Tanks need to lead by example on kicks.`, tone: 'bad' });
  } else if (role === 'HEALER') {
    if (kicks >= 5) lines.push({ icon: '⚡', text: `${kicks} interrupts — impressive kick count for a healer.`, tone: 'good' });
    else if (kicks >= 2) lines.push({ icon: '⚡', text: `${kicks} interrupts. Reasonable for a healer.`, tone: 'info' });
    else lines.push({ icon: '⚡', text: `${kicks} interrupts. Healers should still be kicking when possible.`, tone: 'warn' });
  } else {
    // DPS
    if (kicks >= 8) lines.push({ icon: '⚡', text: `${kicks} interrupts — excellent kick discipline.`, tone: 'good' });
    else if (kicks >= 4) lines.push({ icon: '⚡', text: `${kicks} interrupts. Room to improve, but contributing.`, tone: 'warn' });
    else lines.push({ icon: '⚡', text: `Only ${kicks} interrupts. DPS must kick — no excuses.`, tone: 'bad' });
  }

  /* ── WCL Parse % (universal) ─────────────────────────────────────── */
  const parse = metrics.parsePercent;
  if (parse !== null) {
    const pi = getParseInfo(parse);
    if (parse >= 95) lines.push({ icon: '🏆', text: `${pi.label} parse (${pi.tier}) — elite performance on this dungeon.`, tone: 'good' });
    else if (parse >= 75) lines.push({ icon: '📊', text: `${pi.label} parse (${pi.tier}) — above average.`, tone: 'good' });
    else if (parse >= 50) lines.push({ icon: '📊', text: `${pi.label} parse (${pi.tier}) — middle of the pack.`, tone: 'info' });
    else if (parse >= 25) lines.push({ icon: '📊', text: `${pi.label} parse (${pi.tier}) — below average for this dungeon.`, tone: 'warn' });
    else lines.push({ icon: '📊', text: `${pi.label} parse (${pi.tier}) — bottom quartile. Rough run or undergeared?`, tone: 'bad' });
  }

  /* ── Role-specific performance ──────────────────────────────────── */
  if (role === 'TANK') {
    // Damage taken assessment
    const dmgPct = metrics.damageTakenPercent;
    if (dmgPct !== null) {
      if (dmgPct >= 35 && dmgPct <= 50) {
        lines.push({ icon: '🛡️', text: `${dmgPct}% of group damage taken — solid mitigation.`, tone: 'good' });
      } else if (dmgPct > 50) {
        lines.push({ icon: '🛡️', text: `${dmgPct}% of group damage — using cooldowns on time?`, tone: 'warn' });
      } else if (dmgPct < 35) {
        lines.push({ icon: '🛡️', text: `${dmgPct}% of group damage — very low, check if DPS are eating mechanics.`, tone: 'info' });
      }
    }
    // Tank DPS (still shown as context)
    const dps = metrics.dps ?? 0;
    if (dps > 0) {
      lines.push({ icon: '⚔️', text: `${formatDps(dps)} DPS — contributing offensively as tank.`, tone: 'info' });
    }
    lines.push({ icon: '📋', text: 'Tanks set the pace — big pulls at this key level reward confident routing.', tone: 'info' });

  } else if (role === 'HEALER') {
    // HPS output
    const hps = metrics.hps ?? 0;
    if (hps > 0) {
      lines.push({ icon: '💚', text: `${formatHps(hps)} HPS throughput.`, tone: 'info' });
    }
    // Healer damage taken
    const dmgPct = metrics.damageTakenPercent;
    if (dmgPct !== null) {
      if (dmgPct <= -10) lines.push({ icon: '🛡️', text: `${dmgPct}% vs avg damage taken — great at dodging mechanics.`, tone: 'good' });
      else if (dmgPct <= 10) lines.push({ icon: '🛡️', text: `Damage taken is near average — watch avoidable damage.`, tone: 'info' });
      else lines.push({ icon: '🛡️', text: `+${dmgPct}% vs avg damage taken — healers eating damage makes runs harder.`, tone: 'bad' });
    }
    // Healer DPS as bonus context
    const dps = metrics.dps ?? 0;
    if (dps > 0) {
      lines.push({ icon: '⚔️', text: `${formatDps(dps)} DPS on the side — every bit helps.`, tone: 'info' });
    }
    lines.push({ icon: '📋', text: 'Healers who do damage while keeping the group alive are the real MVPs.', tone: 'info' });

  } else {
    // DPS role — parse % already covers performance, add context
    const dps = metrics.dps ?? 0;
    if (dps > 0) {
      lines.push({ icon: '⚔️', text: `${formatDps(dps)} DPS overall for this run.`, tone: 'info' });
    }
    // DPS damage taken
    const dmgPct = metrics.damageTakenPercent;
    if (dmgPct !== null) {
      if (dmgPct <= -15) lines.push({ icon: '🛡️', text: `${dmgPct}% vs avg damage taken — dodging like a pro.`, tone: 'good' });
      else if (dmgPct <= 5) lines.push({ icon: '🛡️', text: `Damage taken is close to average.`, tone: 'info' });
      else lines.push({ icon: '🛡️', text: `+${dmgPct}% vs avg damage taken — dying to avoidable mechanics.`, tone: 'bad' });
    }
    lines.push({ icon: '📋', text: 'DPS isn\'t just damage — kicks, defensives, and positioning matter.', tone: 'info' });
  }

  return lines;
}

/* ─── Overall verdict summary ──────────────────────────────────────────── */

function getOverallVerdict(
  metrics: PugVettingMetrics,
  role: CharacterRole,
): { label: string; color: string; bg: string } {
  let score = 0;

  // Deaths
  const deaths = metrics.deaths ?? 0;
  if (deaths === 0) score += 3;
  else if (deaths <= 1) score += 1;
  else score -= 1;

  // Interrupts
  const kicks = metrics.interrupts ?? 0;
  const kickTarget = role === 'HEALER' ? 3 : 6;
  if (kicks >= kickTarget) score += 2;
  else if (kicks >= Math.floor(kickTarget / 2)) score += 1;
  else score -= 1;

  // Performance via WCL parse % (role-agnostic — WCL already compares against peers)
  const parse = metrics.parsePercent;
  if (parse !== null) {
    if (parse >= 95) score += 3;
    else if (parse >= 75) score += 2;
    else if (parse >= 50) score += 1;
    else if (parse >= 25) score += 0;
    else score -= 1;
  } else {
    // No parse data — give neutral score
    score += 1;
  }

  // Damage taken
  const dmgPct = metrics.damageTakenPercent ?? 0;
  if (role !== 'TANK') {
    if (dmgPct <= -10) score += 2;
    else if (dmgPct <= 5) score += 1;
    else score -= 1;
  }

  if (score >= 8) return { label: 'Worthy', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20' };
  if (score >= 5) return { label: 'Acceptable', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' };
  if (score >= 2) return { label: 'Questionable', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' };
  return { label: 'Unworthy', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' };
}

export function PugVettingModal({
  run,
  characterName,
  realm,
  region,
  role,
  specName,
  className: charClass,
  onClose,
}: PugVettingModalProps) {
  const [metrics, setMetrics] = useState<PugVettingMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noLogFound, setNoLogFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMetrics(null);
    setNoLogFound(false);

    fetchRunMetrics(characterName, realm, region, run)
      .then((result) => {
        if (cancelled) return;
        if (!result.success) {
          setNoLogFound(result.reason === 'no_log_found');
          setLoading(false);
          return;
        }

        setMetrics(result.metrics);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Unknown error');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [characterName, realm, region, run]);

  const dmgCtx = metrics ? getDamageContext(metrics.damageTakenPercent, metrics.isTank) : null;
  const parseInfo = metrics ? getParseInfo(metrics.parsePercent) : null;
  const isHealer = role === 'HEALER';

  return (
    /* ── Backdrop ─────────────────────────────────────────────────────── */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vetting-title"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* ── Modal card ─────────────────────────────────────────────────── */}
      <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0e0e14] shadow-2xl shadow-black/60 overflow-hidden">

        {/* Top accent line */}
        <div className="h-px w-full bg-gradient-to-r from-transparent via-accent-teal/60 to-transparent" />

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-white/5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-teal-400 text-lg">⚖️</span>
              <h2 id="vetting-title" className="text-white font-bold text-lg">
                Are They Worthy?
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-widest bg-teal-500/10 text-teal-400 border border-teal-500/20">
                {loading ? 'Fetching…' : error ? 'Error' : noLogFound ? 'No Log' : 'Live Data'}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <p className="text-slate-500">
                {characterName} · {realm} · {region.toUpperCase()}
              </p>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                role === 'TANK' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                : role === 'HEALER' ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                : 'bg-red-500/10 text-red-400 border border-red-500/20'
              }`}>
                {specName} {charClass} · {role}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 p-1.5 rounded-lg text-slate-600 hover:text-slate-200 hover:bg-white/5 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* ── Run summary strip ───────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-4 px-6 py-3.5 bg-white/[0.02] border-b border-white/5 text-sm">
          <span className="font-semibold text-slate-200">{run.dungeon}</span>
          <span className="px-2 py-0.5 rounded bg-accent-violet/10 text-accent-violet font-bold text-xs">
            +{run.mythic_level}
          </span>
          {run.score != null && (
            <span className="text-slate-500 text-xs">
              Score: <span className="text-slate-300 font-medium">{run.score.toFixed(1)}</span>
            </span>
          )}
          {run.clear_time_ms != null && (
            <span className="text-slate-500 text-xs">
              Time: <span className="text-slate-300 font-medium tabular-nums">{formatClearTime(run.clear_time_ms)}</span>
            </span>
          )}
          {(run.num_keystone_upgrades ?? 0) > 0 && (
            <span className="text-teal-500 text-xs font-medium">
              +{run.num_keystone_upgrades} Upgrade{(run.num_keystone_upgrades ?? 0) > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* ── Error state ─────────────────────────────────────────────── */}
        {error && (
          <div className="mx-6 mt-5 rounded-xl border border-red-900/40 bg-red-950/10 p-4 text-sm text-red-400 leading-relaxed">
            <div className="flex items-center gap-2 mb-1 font-semibold text-red-300">
              <span>⚠</span> Could not load vetting data
            </div>
            {error}
          </div>
        )}

        {/* ── Metric cards / empty state ─────────────────────────────── */}
        {noLogFound ? (
          <div className="p-6">
            <div className="rounded-2xl border border-white/8 bg-gradient-to-br from-white/[0.04] to-white/[0.02] px-6 py-10 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-2xl">
                📭
              </div>
              <h3 className="text-base font-semibold text-white">No Combat Log Found</h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-400">
                This Mythic+ run was not recorded and uploaded to Warcraft Logs.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 p-6">

            {/* ── Interrupts ─────────────────────────────────────────── */}
            <div className="relative flex flex-col items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-5 text-center shadow-lg shadow-teal-500/20 overflow-hidden">
              <div className="absolute top-0 right-0 w-16 h-16 bg-white/[0.015] rounded-bl-full" />
              <span className="text-2xl leading-none">⚡</span>
              <div className="text-3xl font-black tracking-tight tabular-nums text-teal-400">
                {loading ? <MetricSkeleton /> : (metrics?.interrupts ?? 0)}
              </div>
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-slate-300">Interrupts</div>
                <div className="text-[10px] text-slate-600">Successful kicks</div>
              </div>
            </div>

            {/* ── DPS or HPS (role-dependent) ──────────────────────── */}
            {isHealer ? (
              <div className="relative flex flex-col items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-5 text-center shadow-lg shadow-emerald-500/20 overflow-hidden">
                <div className="absolute top-0 right-0 w-16 h-16 bg-white/[0.015] rounded-bl-full" />
                <span className="text-2xl leading-none">💚</span>
                <div className="text-3xl font-black tracking-tight tabular-nums text-emerald-400">
                  {loading ? <MetricSkeleton /> : formatHps(metrics?.hps ?? 0)}
                </div>
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-slate-300">HPS Output</div>
                  <div className="text-[10px] text-slate-600">Healing per second</div>
                </div>
              </div>
            ) : (
              <div className="relative flex flex-col items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-5 text-center shadow-lg shadow-purple-500/20 overflow-hidden">
                <div className="absolute top-0 right-0 w-16 h-16 bg-white/[0.015] rounded-bl-full" />
                <span className="text-2xl leading-none">⚔️</span>
                <div className="text-3xl font-black tracking-tight tabular-nums text-purple-400">
                  {loading ? <MetricSkeleton /> : formatDps(metrics?.dps ?? 0)}
                </div>
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-slate-300">DPS Output</div>
                  <div className="text-[10px] text-slate-600">Damage per second</div>
                </div>
              </div>
            )}

            {/* ── Damage Taken (Relative) ────────────────────────────── */}
            <div className="relative flex flex-col items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-5 text-center shadow-lg shadow-orange-500/20 overflow-hidden">
              <div className="absolute top-0 right-0 w-16 h-16 bg-white/[0.015] rounded-bl-full" />
              <span className="text-2xl leading-none">🛡️</span>
              <div className={`text-2xl font-black tracking-tight tabular-nums ${loading ? '' : dmgCtx?.color ?? 'text-slate-500'}`}>
                {loading ? <MetricSkeleton /> : dmgCtx?.label ?? 'N/A'}
              </div>
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-slate-300">Damage Taken</div>
                <div className="text-[10px] text-slate-600">
                  {loading
                    ? 'Analyzing…'
                    : metrics?.isTank
                      ? `Tank · ${formatDamageRaw(metrics?.damageTakenRaw ?? 0)} total`
                      : `${formatDamageRaw(metrics?.damageTakenRaw ?? 0)} total`
                  }
                </div>
              </div>
            </div>

            {/* ── Deaths ─────────────────────────────────────────────── */}
            <div className="relative flex flex-col items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-5 text-center shadow-lg shadow-red-500/20 overflow-hidden">
              <div className="absolute top-0 right-0 w-16 h-16 bg-white/[0.015] rounded-bl-full" />
              <span className="text-2xl leading-none">💀</span>
              <div className="text-3xl font-black tracking-tight tabular-nums text-red-400">
                {loading ? <MetricSkeleton /> : (metrics?.deaths ?? 0)}
              </div>
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-slate-300">Deaths</div>
                <div className="text-[10px] text-slate-600">Count across the run</div>
              </div>
            </div>

            {/* ── WCL Parse % (full width) ──────────────────────────── */}
            <div className="relative col-span-2 flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] px-5 py-4 shadow-lg shadow-amber-500/10 overflow-hidden">
              <div className="absolute top-0 right-0 w-20 h-20 bg-white/[0.015] rounded-bl-full" />
              <div className="flex items-center gap-3">
                <span className="text-2xl leading-none">📊</span>
                <div>
                  <div className="text-xs font-semibold text-slate-300">WCL Parse</div>
                  <div className="text-[10px] text-slate-600">{loading ? 'Loading…' : parseInfo?.tier || 'Dungeon percentile rank'}</div>
                </div>
              </div>
              <div className={`text-3xl font-black tracking-tight tabular-nums ${loading ? '' : parseInfo?.color ?? 'text-slate-500'}`}>
                {loading ? <MetricSkeleton /> : parseInfo?.label ?? 'N/A'}
              </div>
            </div>

          </div>
        )}

        {/* ── Role-specific verdict ─────────────────────────────────────── */}
        {metrics && !error && !noLogFound && (
          <div className="px-6 pb-2">
            {(() => {
              const overall = getOverallVerdict(metrics, role);
              const verdictLines = buildVerdict(metrics, role);
              return (
                <div className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
                  {/* Overall verdict banner */}
                  <div className={`flex items-center justify-between px-4 py-3 border-b border-white/5 ${overall.bg}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-base">⚖️</span>
                      <span className="text-sm font-bold text-white">Verdict</span>
                    </div>
                    <span className={`text-sm font-black uppercase tracking-wider ${overall.color}`}>
                      {overall.label}
                    </span>
                  </div>
                  {/* Line-by-line breakdown */}
                  <div className="p-4 space-y-2">
                    {verdictLines.map((line, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                        <span className="shrink-0 mt-0.5">{line.icon}</span>
                        <span className={TONE_COLORS[line.tone]}>{line.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ── Footer notice ───────────────────────────────────────────── */}
        {!error && (
          <div className="px-6 pb-5">
            <div className="rounded-lg bg-white/[0.02] border border-white/5 px-4 py-2.5 flex items-center gap-2">
              <span className="text-slate-600 text-xs">ℹ</span>
              <p className="text-slate-600 text-xs">
                {loading
                  ? 'Querying Warcraft Logs…'
                  : noLogFound
                    ? 'No uploaded Warcraft Logs report could be matched to this Raider.io run.'
                    : `Judged as ${role.toLowerCase()} (${specName} ${charClass}). Metrics from the best-logged run.`}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
