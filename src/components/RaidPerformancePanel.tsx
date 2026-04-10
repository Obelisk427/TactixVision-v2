import { useState, useEffect, useMemo } from 'react';
import type { PanelState, WCLBothTiersData, TierSelection, ProcessedBossData } from '../types';
import { LoadingCard } from './LoadingCard';

interface RaidPerformancePanelProps {
  state: PanelState<WCLBothTiersData>;
  /** Controls which tier's zone + boss data is displayed. */
  tier: TierSelection;
}

type Difficulty = 'normal' | 'heroic' | 'mythic';

function getRankBadgeClass(percent: number | null): string {
  if (percent == null) return 'bg-white/5 text-slate-600';
  if (percent >= 99) return 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30';
  if (percent >= 95) return 'bg-orange-500/15 text-orange-400 ring-1 ring-orange-500/30';
  if (percent >= 75) return 'bg-purple-500/15 text-purple-400 ring-1 ring-purple-500/30';
  if (percent >= 50) return 'bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30';
  if (percent >= 25) return 'bg-green-500/15 text-green-400 ring-1 ring-green-500/30';
  return 'bg-white/5 text-slate-500';
}

function getRankTierLabel(percent: number | null): string {
  if (percent == null) return '';
  if (percent >= 99) return 'Legendary';
  if (percent >= 95) return 'Epic';
  if (percent >= 75) return 'Rare';
  if (percent >= 50) return 'Uncommon';
  if (percent >= 25) return 'Common';
  return 'Poor';
}

function formatKillTime(ms: number | null): string {
  if (!ms) return '—';
  const totalSec = Math.floor(ms / 1000);
  return `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`;
}

/* ─── Raid Verdict System ───────────────────────────────────────────────── */

interface RaidVerdictLine {
  icon: string;
  text: string;
  tone: 'good' | 'warn' | 'bad' | 'info';
}

interface RaidVerdict {
  overall: { label: string; color: string; bg: string };
  lines: RaidVerdictLine[];
  stats: {
    avgParse: number | null;
    medianParse: number | null;
    totalKills: number;
    bossesKilled: number;
    totalBosses: number;
    grayParses: number;
    greenParses: number;
    purpleParses: number;
    orangeParses: number;
    goldParses: number;
  };
}

function analyzeRaidPerformance(bosses: ProcessedBossData[], difficulty: Difficulty): RaidVerdict {
  const lines: RaidVerdictLine[] = [];

  // Gather all boss data for this difficulty
  const killedBosses = bosses.filter((b) => (b[difficulty].kills ?? 0) > 0);
  const parses = killedBosses
    .map((b) => b[difficulty].rankPercent)
    .filter((p): p is number => p !== null);
  const totalKills = killedBosses.reduce((sum, b) => sum + (b[difficulty].kills ?? 0), 0);

  // Parse distribution
  const grayParses = parses.filter((p) => p < 25).length;
  const greenParses = parses.filter((p) => p >= 25 && p < 50).length;
  const purpleParses = parses.filter((p) => p >= 75 && p < 95).length;
  const orangeParses = parses.filter((p) => p >= 95 && p < 99).length;
  const goldParses = parses.filter((p) => p >= 99).length;

  // Averages
  const avgParse = parses.length > 0 ? Math.round(parses.reduce((a, b) => a + b, 0) / parses.length) : null;
  const sortedParses = [...parses].sort((a, b) => a - b);
  const medianParse = sortedParses.length > 0
    ? sortedParses.length % 2 === 0
      ? Math.round((sortedParses[sortedParses.length / 2 - 1] + sortedParses[sortedParses.length / 2]) / 2)
      : Math.round(sortedParses[Math.floor(sortedParses.length / 2)])
    : null;

  // Consistency (spread between worst and best)
  const minParse = sortedParses.length > 0 ? sortedParses[0] : null;
  const maxParse = sortedParses.length > 0 ? sortedParses[sortedParses.length - 1] : null;

  /* ── Progression ──────────────────────────────────────────────── */
  const bossesKilled = killedBosses.length;
  const totalBosses = bosses.length;

  if (bossesKilled === 0) {
    lines.push({ icon: '📭', text: `No kills at ${difficulty} difficulty.`, tone: 'info' });
    return {
      overall: { label: 'No Data', color: 'text-slate-500', bg: 'bg-white/5 border-white/10' },
      lines,
      stats: { avgParse: null, medianParse: null, totalKills: 0, bossesKilled: 0, totalBosses, grayParses: 0, greenParses: 0, purpleParses: 0, orangeParses: 0, goldParses: 0 },
    };
  }

  if (bossesKilled === totalBosses) {
    lines.push({ icon: '✅', text: `Full clear — ${bossesKilled}/${totalBosses} bosses killed.`, tone: 'good' });
  } else if (bossesKilled >= totalBosses * 0.5) {
    lines.push({ icon: '📊', text: `${bossesKilled}/${totalBosses} bosses killed — decent progression.`, tone: 'info' });
  } else {
    lines.push({ icon: '⚠️', text: `Only ${bossesKilled}/${totalBosses} bosses killed — limited progression.`, tone: 'warn' });
  }

  /* ── Average parse ────────────────────────────────────────────── */
  if (avgParse !== null) {
    if (avgParse >= 90) lines.push({ icon: '🏆', text: `${avgParse} avg parse — elite raider.`, tone: 'good' });
    else if (avgParse >= 75) lines.push({ icon: '📊', text: `${avgParse} avg parse — strong performer.`, tone: 'good' });
    else if (avgParse >= 50) lines.push({ icon: '📊', text: `${avgParse} avg parse — middle of the pack.`, tone: 'info' });
    else if (avgParse >= 25) lines.push({ icon: '📊', text: `${avgParse} avg parse — below average.`, tone: 'warn' });
    else lines.push({ icon: '📊', text: `${avgParse} avg parse — consistently low.`, tone: 'bad' });
  }

  /* ── Consistency ──────────────────────────────────────────────── */
  if (minParse !== null && maxParse !== null && parses.length >= 3) {
    const spread = maxParse - minParse;
    if (spread <= 15) {
      lines.push({ icon: '🎯', text: `Very consistent — ${minParse.toFixed(0)}% to ${maxParse.toFixed(0)}% spread.`, tone: 'good' });
    } else if (spread <= 35) {
      lines.push({ icon: '🎯', text: `Some variance — ${minParse.toFixed(0)}% to ${maxParse.toFixed(0)}% across bosses.`, tone: 'info' });
    } else {
      lines.push({ icon: '🎯', text: `Wildly inconsistent — ${minParse.toFixed(0)}% low, ${maxParse.toFixed(0)}% high. Possible carry on some fights.`, tone: 'warn' });
    }
  }

  /* ── Gray/green parse flags ───────────────────────────────────── */
  if (grayParses >= 2) {
    lines.push({ icon: '🚩', text: `${grayParses} gray parse${grayParses > 1 ? 's' : ''} (below 25%) — red flag for being carried.`, tone: 'bad' });
  } else if (grayParses === 1) {
    lines.push({ icon: '⚠️', text: `1 gray parse — could be a bad pull or an unfamiliar fight.`, tone: 'warn' });
  }

  if (goldParses + orangeParses >= 2) {
    lines.push({ icon: '🔥', text: `${goldParses + orangeParses} orange/gold parse${goldParses + orangeParses > 1 ? 's' : ''} — this player pumps.`, tone: 'good' });
  }

  /* ── Experience ───────────────────────────────────────────────── */
  if (totalKills >= 30) {
    lines.push({ icon: '📋', text: `${totalKills} total kills — very experienced at this difficulty.`, tone: 'good' });
  } else if (totalKills >= 15) {
    lines.push({ icon: '📋', text: `${totalKills} total kills — moderate experience.`, tone: 'info' });
  } else if (totalKills >= bossesKilled) {
    lines.push({ icon: '📋', text: `${totalKills} total kills — limited experience. Mostly 1-kill bosses.`, tone: 'warn' });
  }

  /* ── Overall verdict ──────────────────────────────────────────── */
  let score = 0;

  // Progression
  if (bossesKilled === totalBosses) score += 2;
  else if (bossesKilled >= totalBosses * 0.5) score += 1;

  // Average parse
  if (avgParse !== null) {
    if (avgParse >= 90) score += 4;
    else if (avgParse >= 75) score += 3;
    else if (avgParse >= 50) score += 2;
    else if (avgParse >= 25) score += 1;
    else score -= 1;
  }

  // Gray parse penalty
  score -= grayParses;

  // Experience bonus
  if (totalKills >= 30) score += 1;

  // Orange/gold bonus
  score += Math.min(goldParses + orangeParses, 2);

  let overall: RaidVerdict['overall'];
  if (score >= 7) overall = { label: 'Worthy', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20' };
  else if (score >= 4) overall = { label: 'Acceptable', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' };
  else if (score >= 2) overall = { label: 'Questionable', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' };
  else overall = { label: 'Unworthy', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' };

  return {
    overall,
    lines,
    stats: { avgParse, medianParse, totalKills, bossesKilled, totalBosses, grayParses, greenParses, purpleParses, orangeParses, goldParses },
  };
}

const VERDICT_TONE_COLORS: Record<RaidVerdictLine['tone'], string> = {
  good: 'text-green-400',
  warn: 'text-orange-400',
  bad: 'text-red-400',
  info: 'text-slate-400',
};

/** Detect the highest difficulty that has at least one kill. */
function detectHighestDifficulty(bosses: ProcessedBossData[]): Difficulty {
  const diffs: Difficulty[] = ['mythic', 'heroic', 'normal'];
  for (const d of diffs) {
    if (bosses.some((b) => (b[d].kills ?? 0) > 0)) return d;
  }
  return 'mythic'; // fallback if no kills at all
}

export function RaidPerformancePanel({ state, tier }: RaidPerformancePanelProps) {
  const [difficulty, setDifficulty] = useState<Difficulty>('mythic');
  const [hasAutoSelected, setHasAutoSelected] = useState(false);
  const [showVerdict, setShowVerdict] = useState(false);

  // Determine the tier data for auto-detection
  const tierData = state.data
    ? tier === 'current' ? state.data.current : state.data.previous
    : null;

  // Auto-detect highest difficulty when tier data first loads or tier changes
  const detectedDifficulty = useMemo(
    () => tierData ? detectHighestDifficulty(tierData.bosses) : 'mythic' as Difficulty,
    [tierData],
  );

  useEffect(() => {
    if (tierData) {
      setDifficulty(detectedDifficulty);
      setHasAutoSelected(true);
    }
  }, [tierData, detectedDifficulty]);

  // Reset auto-select flag when tier changes so it re-detects
  useEffect(() => {
    setHasAutoSelected(false);
  }, [tier]);

  if (state.loading) return <LoadingCard />;

  if (state.error) {
    return (
      <div className="rounded-xl border border-red-900/40 bg-red-950/10 p-6 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-red-500">✗</span>
          <h2 className="text-base font-bold text-white">Raid Performance</h2>
        </div>
        <p className="text-red-400 text-sm leading-relaxed">{state.error}</p>
      </div>
    );
  }

  if (!state.data) return null;

  // tierData already computed above for auto-detection; reuse it here
  if (!tierData) {
    return (
      <div className="rounded-xl border border-white/5 bg-bg-card p-6 space-y-3">
        <h2 className="text-base font-bold text-white">Raid Performance</h2>
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-4 text-center text-sm text-slate-500">
          No previous tier data found for this character on Warcraft Logs.
        </div>
      </div>
    );
  }

  const { zone, bosses, characterName, characterRegion, characterServerSlug } = tierData;
  const killedBosses = bosses.filter((b) => (b[difficulty].kills ?? 0) > 0);
  const progress = `${killedBosses.length}/${bosses.length}`;
  const difficultyNum: Record<Difficulty, number> = { normal: 3, heroic: 4, mythic: 5 };

  const bossUrl = (encounterId: number) =>
    `https://www.warcraftlogs.com/character/${characterRegion}/${characterServerSlug}/${characterName.toLowerCase()}` +
    `#zone=${zone.id}&boss=${encounterId}&difficulty=${difficultyNum[difficulty]}`;

  return (
    <div className="rounded-xl border border-white/5 bg-bg-card p-6 space-y-5 flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-white">Raid Performance</h2>
          <p className="text-xs text-slate-600 mt-0.5">{zone.name}</p>
        </div>
        <div className="text-xs text-slate-600 text-right shrink-0">
          <div>{characterName}</div>
          <div className="mt-0.5">
            <span className="text-slate-400 font-semibold">{progress}</span>
            {' '}
            <span className="capitalize">{difficulty}</span> Kills
          </div>
        </div>
      </div>

      {/* ── Difficulty Tabs ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1 bg-bg-primary/60 rounded-lg p-1 w-fit border border-white/5">
          {(['normal', 'heroic', 'mythic'] as Difficulty[]).map((d) => {
            const hasKills = bosses.some((b) => (b[d].kills ?? 0) > 0);
            return (
              <button
                key={d}
                id={`raid-tab-${d}`}
                onClick={() => setDifficulty(d)}
                className={`px-4 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wide transition-all ${
                  difficulty === d
                    ? 'bg-gradient-to-r from-accent-violet to-accent-teal text-white shadow-md'
                    : hasKills
                      ? 'text-slate-400 hover:text-slate-200'
                      : 'text-slate-600 hover:text-slate-400'
                }`}
              >
                {d}
              </button>
            );
          })}
        </div>
        {hasAutoSelected && difficulty === detectedDifficulty && (
          <span className="text-[10px] text-slate-600 uppercase tracking-wider">
            ← highest prog
          </span>
        )}
      </div>

      {/* ── Boss Table ──────────────────────────────────────────────── */}
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm min-w-[380px]">
          <thead>
            <tr className="text-slate-600 uppercase text-[10px] tracking-wider">
              <th className="text-left pb-2.5 pl-1 font-medium w-6">#</th>
              <th className="text-left pb-2.5 font-medium">Boss</th>
              <th className="text-center pb-2.5 font-medium">Best %</th>
              <th className="text-center pb-2.5 font-medium">Kills</th>
              <th className="text-right pb-2.5 pr-1 font-medium">Best Kill</th>
            </tr>
          </thead>
          <tbody>
            {bosses.map((boss, idx) => {
              const d = boss[difficulty];
              const hasKill = (d.kills ?? 0) > 0;

              return (
                <tr
                  key={boss.encounterId}
                  className={`border-t border-white/[0.04] transition-colors ${
                    hasKill ? 'hover:bg-white/[0.02]' : 'opacity-40'
                  }`}
                >
                  <td className="py-2.5 pl-1 text-slate-700 text-xs tabular-nums">{idx + 1}</td>
                  <td className="py-2.5 text-slate-200 font-medium">
                    <a
                      href={bossUrl(boss.encounterId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-accent-teal hover:underline underline-offset-2 transition-colors"
                    >
                      {boss.encounterName}
                    </a>
                  </td>
                  <td className="py-2.5 text-center">
                    {d.rankPercent != null ? (
                      d.reportCode ? (
                        <a
                          href={`https://www.warcraftlogs.com/reports/${d.reportCode}#fight=${d.reportFightID ?? 'last'}&type=damage-done`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`${getRankTierLabel(d.rankPercent)} — open in Warcraft Logs`}
                          className={`inline-block px-2 py-0.5 rounded text-xs font-bold ring-1 ring-transparent hover:ring-accent-teal/60 hover:brightness-125 transition-all ${getRankBadgeClass(d.rankPercent)}`}
                        >
                          {d.rankPercent.toFixed(1)}%
                        </a>
                      ) : (
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${getRankBadgeClass(d.rankPercent)}`}
                          title={getRankTierLabel(d.rankPercent)}
                        >
                          {d.rankPercent.toFixed(1)}%
                        </span>
                      )
                    ) : (
                      <span className="text-slate-700 text-xs">—</span>
                    )}
                  </td>
                  <td className="py-2.5 text-center tabular-nums">
                    {d.kills != null ? (
                      <span className="font-semibold text-slate-300">{d.kills}</span>
                    ) : (
                      <span className="text-slate-600 text-xs">0</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-1 text-right text-slate-600 text-xs tabular-nums">
                    {d.fastestKill && d.reportCode ? (
                      <a
                        href={`https://www.warcraftlogs.com/reports/${d.reportCode}#fight=${d.reportFightID ?? 'last'}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-accent-teal hover:underline transition-colors"
                      >
                        {formatKillTime(d.fastestKill)}
                      </a>
                    ) : (
                      formatKillTime(d.fastestKill)
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Judge Raid Button ──────────────────────────────────────── */}
      <div className="border-t border-white/5 pt-4">
        <button
          onClick={() => setShowVerdict((v) => !v)}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold uppercase tracking-wide transition-all ${
            showVerdict
              ? 'bg-gradient-to-r from-accent-violet to-accent-teal text-white shadow-md'
              : 'text-slate-500 border border-white/5 bg-white/[0.03] hover:text-accent-teal hover:border-accent-teal/40 hover:bg-accent-teal/5 hover:shadow-[0_0_10px_rgba(20,184,166,0.15)]'
          }`}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          {showVerdict ? 'Hide Verdict' : 'Judge Raid Performance'}
        </button>
      </div>

      {/* ── Raid Verdict ──────────────────────────────────────────── */}
      {showVerdict && (() => {
        const verdict = analyzeRaidPerformance(bosses, difficulty);
        return (
          <div className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
            {/* Overall verdict banner */}
            <div className={`flex items-center justify-between px-4 py-3 border-b border-white/5 ${verdict.overall.bg}`}>
              <div className="flex items-center gap-2">
                <span className="text-base">⚖️</span>
                <span className="text-sm font-bold text-white">Raid Verdict</span>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider capitalize">{difficulty}</span>
              </div>
              <span className={`text-sm font-black uppercase tracking-wider ${verdict.overall.color}`}>
                {verdict.overall.label}
              </span>
            </div>

            {/* Stats summary bar */}
            {verdict.stats.avgParse !== null && (
              <div className="flex items-center gap-4 px-4 py-3 border-b border-white/5 bg-white/[0.01]">
                <div className="text-center">
                  <div className={`text-lg font-black tabular-nums ${
                    verdict.stats.avgParse >= 75 ? 'text-purple-400'
                    : verdict.stats.avgParse >= 50 ? 'text-blue-400'
                    : verdict.stats.avgParse >= 25 ? 'text-green-400'
                    : 'text-slate-500'
                  }`}>
                    {verdict.stats.avgParse}
                  </div>
                  <div className="text-[10px] text-slate-600">Avg Parse</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-black tabular-nums text-slate-300">
                    {verdict.stats.medianParse}
                  </div>
                  <div className="text-[10px] text-slate-600">Median</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-black tabular-nums text-slate-300">
                    {verdict.stats.bossesKilled}/{verdict.stats.totalBosses}
                  </div>
                  <div className="text-[10px] text-slate-600">Prog</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-black tabular-nums text-slate-300">
                    {verdict.stats.totalKills}
                  </div>
                  <div className="text-[10px] text-slate-600">Kills</div>
                </div>
                {/* Parse distribution dots */}
                <div className="ml-auto flex items-center gap-1.5">
                  {verdict.stats.goldParses > 0 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-400">{verdict.stats.goldParses} gold</span>
                  )}
                  {verdict.stats.orangeParses > 0 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-500/15 text-orange-400">{verdict.stats.orangeParses} orange</span>
                  )}
                  {verdict.stats.purpleParses > 0 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/15 text-purple-400">{verdict.stats.purpleParses} purple</span>
                  )}
                  {verdict.stats.grayParses > 0 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-white/5 text-slate-500">{verdict.stats.grayParses} gray</span>
                  )}
                </div>
              </div>
            )}

            {/* Line-by-line breakdown */}
            <div className="p-4 space-y-2">
              {verdict.lines.map((line, i) => (
                <div key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                  <span className="shrink-0 mt-0.5">{line.icon}</span>
                  <span className={VERDICT_TONE_COLORS[line.tone]}>{line.text}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
