import { useState, useEffect, useRef, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, Play, Trash2, RefreshCw, AlertCircle, CheckCircle, XCircle, Clock, Users, Timer, TrendingUp, TrendingDown, Minus, Flame, Compass, GitMerge, FileCheck, Feather, PersonStanding, Swords, Dumbbell } from 'lucide-react'
import { getWeightClasses, startSuperfight, getSuperfight, getActiveSuperfight, listSuperfights, deleteSuperfight, compareSuperfights, listLoadTestUsers, getEnvConfig, getScenarios } from '../api'
import { useAdmin } from '../AdminContext'
import { formatDt, formatMs, formatSec } from '../api'

const WC_ICONS = {
  flyweight:     { icon: Feather,         color: '#16a34a' },
  featherweight: { icon: PersonStanding,  color: '#2563eb' },
  middleweight:  { icon: Swords,          color: '#ca8a04' },
  heavyweight:   { icon: Dumbbell,        color: '#ea580c' },
  superfight:    { icon: Flame,           color: '#dc2626' },
}

const FIGHT_MODES = [
  { id: 'fixed', label: 'Fixed', desc: 'Predefined scenarios', icon: FileCheck, color: 'var(--green)' },
  { id: 'fire', label: 'Fire', desc: 'Autonomous AI actor', icon: Flame, color: 'var(--red)' },
  { id: 'explore', label: 'Explore', desc: 'AI decides dynamically', icon: Compass, color: 'var(--accent)' },
  { id: 'hybrid', label: 'Hybrid', desc: 'AI-generated plan', icon: GitMerge, color: 'var(--orange)' },
]

function GradeBadge({ benchmark }) {
  if (!benchmark) return null
  const { grade, grade_label, grade_color, overall_score } = benchmark
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
      padding: '0.3rem 0.6rem', borderRadius: 'var(--radius)',
      background: `${grade_color}15`, border: `1px solid ${grade_color}40`,
    }}>
      <span style={{ fontSize: '1rem', fontWeight: 700, color: grade_color }}>{grade}</span>
      <div style={{ fontSize: '0.65rem', lineHeight: 1.2 }}>
        <div style={{ fontWeight: 600, color: grade_color }}>{overall_score}/5</div>
        <div style={{ color: 'var(--text-muted)' }}>{grade_label}</div>
      </div>
    </div>
  )
}

function BenchmarkPanel({ benchmark }) {
  if (!benchmark) return null
  const { latency, quality, reliability } = benchmark
  return (
    <div>
      <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Benchmark Score</div>
      <GradeBadge benchmark={benchmark} />
      <div style={{ marginTop: '0.5rem', fontSize: '0.68rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.2rem 0.75rem' }}>
        <div style={{ color: 'var(--text-secondary)' }}>TTFT Avg: <strong style={{ color: latency?.avg?.ttfb?.color }}>{latency?.avg?.ttfb?.label}</strong></div>
        <div style={{ color: 'var(--text-secondary)' }}>Full Answer Avg: <strong style={{ color: latency?.avg?.total?.color }}>{latency?.avg?.total?.label}</strong></div>
        <div style={{ color: 'var(--text-secondary)' }}>TTFT P95: <strong style={{ color: latency?.p95?.ttfb?.color }}>{latency?.p95?.ttfb?.label}</strong></div>
        <div style={{ color: 'var(--text-secondary)' }}>Full Answer P95: <strong style={{ color: latency?.p95?.total?.color }}>{latency?.p95?.total?.label}</strong></div>
        <div style={{ color: 'var(--text-secondary)' }}>Response: <strong>{quality?.response_rate?.score}/5</strong></div>
        <div style={{ color: 'var(--text-secondary)' }}>Completion: <strong>{quality?.completion_rate?.score}/5</strong></div>
        <div style={{ color: 'var(--text-secondary)' }}>Tools: <strong>{quality?.tool_engagement?.score}/5</strong></div>
        <div style={{ color: 'var(--text-secondary)' }}>Reliability: <strong>{reliability?.error_rate?.score}/5</strong></div>
      </div>
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    completed: { color: 'var(--green)', icon: <CheckCircle size={11} /> },
    running: { color: 'var(--blue)', icon: <RefreshCw size={11} className="spinning" /> },
    error: { color: 'var(--red)', icon: <XCircle size={11} /> },
    pending: { color: 'var(--yellow)', icon: <Clock size={11} /> },
  }
  const s = map[status] || map.pending
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: s.color, fontSize: '0.73rem', fontWeight: 500 }}>
      {s.icon} {status}
    </span>
  )
}

function LatencyBar({ label, value, max = 30000 }) {
  const pct = Math.min((value / max) * 100, 100)
  const color = value < 5000 ? 'var(--green)' : value < 15000 ? 'var(--yellow)' : 'var(--red)'
  return (
    <div style={{ marginBottom: '0.3rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
        <span>{label}</span>
        <span style={{ fontFamily: 'monospace', fontWeight: 500 }}>{value > 0 ? formatMs(value) : '-'}</span>
      </div>
      <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ textAlign: 'center', padding: '0.5rem', background: 'var(--bg-primary)', borderRadius: '6px' }}>
      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: color || 'var(--text-primary)' }}>{value}</div>
      <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{label}</div>
      {sub && <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  )
}

function QualityBar({ label, value, max = 1 }) {
  const pct = Math.min((value / max) * 100, 100)
  const color = pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--yellow)' : 'var(--red)'
  return (
    <div style={{ marginBottom: '0.3rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
        <span>{label}</span>
        <span style={{ fontFamily: 'monospace', fontWeight: 500 }}>{(value * 100).toFixed(1)}%</span>
      </div>
      <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

function QualityPanel({ quality }) {
  if (!quality || (!quality.response_rate && !quality.completion_rate)) return null
  return (
    <div>
      <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Quality</div>
      <QualityBar label="Response Rate" value={quality.response_rate || 0} />
      <QualityBar label="Completion Rate" value={quality.completion_rate || 0} />
      <QualityBar label="Tool Engagement" value={quality.tool_engagement || 0} />
      {quality.avg_response_length > 0 && (
        <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
          Avg response: {Math.round(quality.avg_response_length)} chars
        </div>
      )}
    </div>
  )
}

function SessionTable({ sessions }) {
  const [expanded, setExpanded] = useState(null)
  if (!sessions || sessions.length === 0) return null
  return (
    <div style={{ overflow: 'auto', maxHeight: '400px', marginTop: '0.75rem' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1 }}>
            <th style={{ padding: '0.4rem 0.5rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Fighter</th>
            <th style={{ padding: '0.4rem 0.5rem', color: 'var(--text-secondary)', fontWeight: 600 }}>xP</th>
            <th style={{ padding: '0.4rem 0.5rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Status</th>
            <th style={{ padding: '0.4rem 0.5rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Rounds</th>
            <th style={{ padding: '0.4rem 0.5rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Avg TTFT</th>
            <th style={{ padding: '0.4rem 0.5rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Avg Total</th>
            <th style={{ padding: '0.4rem 0.5rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Duration</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map(s => (
            <Fragment key={s.session_key}>
              <tr style={{ borderBottom: '1px solid var(--border)', cursor: s.turns ? 'pointer' : 'default', background: expanded === s.session_key ? 'var(--bg-primary)' : 'transparent' }}
                onClick={() => s.turns && setExpanded(expanded === s.session_key ? null : s.session_key)}>
                <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace', fontSize: '0.68rem' }}>
                  {s.turns ? <span style={{ color: 'var(--accent)', marginRight: '0.2rem' }}>{expanded === s.session_key ? '\u25BC' : '\u25B6'}</span> : null}
                  {(s.email || '').replace(/.*\+/, '+').replace(/@.*/, '')}
                </td>
                <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                  #{s.window}
                </td>
                <td style={{ padding: '0.4rem 0.5rem' }}><StatusBadge status={s.status} /></td>
                <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace' }}>
                  {s.turns_completed}/{s.turns_total}
                </td>
                <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                  {s.avg_ttfb_ms > 0 ? formatMs(s.avg_ttfb_ms) : '-'}
                </td>
                <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                  {s.avg_total_ms > 0 ? formatMs(s.avg_total_ms) : '-'}
                </td>
                <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                  {s.duration_s > 0 ? formatSec(s.duration_s) : '-'}
                </td>
              </tr>
              {expanded === s.session_key && s.turns && (
                <tr>
                  <td colSpan={7} style={{ padding: 0 }}>
                    <div style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-primary)', borderBottom: '2px solid var(--border)' }}>
                      {s.turns.map(t => (
                        <div key={t.turn} style={{ marginBottom: '0.5rem', fontSize: '0.7rem' }}>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', marginBottom: '0.15rem' }}>
                            <span style={{ fontWeight: 600, color: 'var(--accent)', minWidth: '2.5rem' }}>R{t.turn}</span>
                            {t.ttfb_ms != null && <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: '0.65rem' }}>TTFT:{formatMs(t.ttfb_ms)}</span>}
                            {t.total_ms != null && <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: '0.65rem' }}>Total:{formatMs(t.total_ms)}</span>}
                            {t.tool_calls > 0 && <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: '0.65rem' }}>{t.tool_calls} tools</span>}
                          </div>
                          {t.message && (
                            <div style={{ padding: '0.3rem 0.5rem', background: 'var(--bg-card)', borderRadius: '4px', marginBottom: '0.15rem', borderLeft: '2px solid var(--accent)' }}>
                              <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontWeight: 600 }}>USER</span>
                              <div style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{t.message}</div>
                            </div>
                          )}
                          {t.response && (
                            <div style={{ padding: '0.3rem 0.5rem', background: 'var(--bg-card)', borderRadius: '4px', borderLeft: '2px solid var(--green)' }}>
                              <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontWeight: 600 }}>KAI</span>
                              <div style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{t.response}</div>
                            </div>
                          )}
                        </div>
                      ))}
                      {s.errors && s.errors.length > 0 && (
                        <div style={{ marginTop: '0.3rem', fontSize: '0.65rem', color: 'var(--red)' }}>
                          {s.errors.map((e, i) => <div key={i}>{e}</div>)}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function SuperfightArena() {
  const { admin } = useAdmin()
  const navigate = useNavigate()
  const [weightClasses, setWeightClasses] = useState({})
  const [envKey, setEnvKey] = useState('')
  const [envOptions, setEnvOptions] = useState([])
  const [activeUserCount, setActiveUserCount] = useState(0)

  // Launch form
  const [selectedWC, setSelectedWC] = useState('flyweight')
  const [numUsers, setNumUsers] = useState(2)
  const [windowsPerUser, setWindowsPerUser] = useState(1)
  const [fightMode, setFightMode] = useState('fixed')
  const [scenarios, setScenarios] = useState([])
  const [scenarioCategory, setScenarioCategory] = useState('')
  const [turnsPerSession, setTurnsPerSession] = useState(3)
  const [rampUpS, setRampUpS] = useState(0)
  const [intervalS, setIntervalS] = useState(0)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState(null)

  // Live fight
  const [activeFight, setActiveFight] = useState(null)
  const pollRef = useRef(null)

  // History + comparison
  const [history, setHistory] = useState([])
  const [comparison, setComparison] = useState(null)
  const [expandedFight, setExpandedFight] = useState(null)
  const [expandedFightData, setExpandedFightData] = useState(null)

  useEffect(() => {
    getWeightClasses().then(d => setWeightClasses(d.weight_classes || {})).catch(() => {})
    getEnvConfig().then(cfg => {
      const envs = cfg.environments || {}
      setEnvOptions(Object.entries(envs).map(([k, v]) => ({ key: k, name: v.name })))
      setEnvKey(cfg.active || 'production')
    }).catch(() => {})
    getScenarios().then(d => setScenarios(d.scenarios || [])).catch(() => {})
    // Auto-resume: check for running superfight
    getActiveSuperfight().then(data => {
      if (data && data.id) {
        setActiveFight(data)
        if (data.status === 'running' || data.status === 'pending') {
          setLaunching(true)
          pollFight(data.id)
        }
      }
    }).catch(() => {})
  }, [])

  const scenarioCategories = [...new Set(scenarios.map(s => s.category))].sort()
  const filteredScenarios = scenarioCategory ? scenarios.filter(s => s.category === scenarioCategory) : scenarios

  useEffect(() => {
    if (envKey) {
      listLoadTestUsers(envKey).then(d => {
        setActiveUserCount((d.summary || {}).active || 0)
      }).catch(() => {})
      loadHistory()
    }
  }, [envKey])

  useEffect(() => {
    const wc = weightClasses[selectedWC]
    if (wc) setNumUsers(Math.min(activeUserCount, Math.max(1, Math.ceil(wc.min / Math.max(windowsPerUser, 1)))))
  }, [selectedWC, weightClasses, activeUserCount])

  const totalSessions = numUsers * windowsPerUser
  const selectedWCData = weightClasses[selectedWC] || {}
  const boutsExceedMax = selectedWCData.max && totalSessions > selectedWCData.max
  const boutsBelowMin = selectedWCData.min && totalSessions < selectedWCData.min
  // Find which weight class the actual bout count falls into
  const actualWC = Object.entries(weightClasses).find(([, v]) => totalSessions >= v.min && totalSessions <= v.max)?.[0]

  const loadHistory = async () => {
    try {
      const [histData, compData] = await Promise.all([
        listSuperfights(20, envKey),
        compareSuperfights(envKey, 10),
      ])
      setHistory(histData.fights || [])
      setComparison(compData)
    } catch {}
  }

  const pollFight = (fightId) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const data = await getSuperfight(fightId)
        setActiveFight(data)
        if (data.status !== 'running' && data.status !== 'pending') {
          clearInterval(pollRef.current)
          pollRef.current = null
          setLaunching(false)
          loadHistory()
        }
      } catch {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }, 3000)
  }

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  const handleLaunch = async () => {
    if (!admin) { setError('Admin login required'); return }
    setLaunching(true)
    setError(null)
    setActiveFight(null)
    try {
      const effectiveTurns = fightMode === 'fixed' && filteredScenarios.length > 0
        ? filteredScenarios.length
        : turnsPerSession
      const data = await startSuperfight({
        weightClass: selectedWC, numUsers, windowsPerUser, turnsPerSession: effectiveTurns,
        rampUpS, intervalS, envKey, fightMode,
        scenarioCategory: fightMode === 'fixed' ? scenarioCategory : undefined,
      })
      setActiveFight({ ...data, status: 'running', progress: { total_sessions: totalSessions, completed: 0, errors: 0, running: 0, total_turns: 0 }, latency: {}, sessions: [] })
      pollFight(data.fight_id)
    } catch (e) {
      setError(e.message)
      setLaunching(false)
    }
  }

  const handleDelete = async (fightId) => {
    if (!admin) return
    if (!confirm('Delete this superfight record?')) return
    try {
      await deleteSuperfight(fightId)
      loadHistory()
    } catch (e) { setError(e.message) }
  }

  const wc = weightClasses[selectedWC] || {}
  const prog = activeFight?.progress || {}
  const lat = activeFight?.latency || {}

  return (
    <div className="page">
      <div className="page-header">
        <h2><Zap size={20} /> Superfight Camp</h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select value={envKey} onChange={e => setEnvKey(e.target.value)}
            style={{ padding: '0.35rem 0.5rem', fontSize: '0.78rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
            {envOptions.map(e => <option key={e.key} value={e.key}>{e.name}</option>)}
          </select>
          <button onClick={() => navigate('/load-test/fighters')} className="secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.73rem' }}>
            <Users size={12} /> Talent Scouting ({activeUserCount})
          </button>
        </div>
      </div>

      {error && (
        <div className="alert error" style={{ marginBottom: '1rem' }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* Configuration — visible to all, editable by admin only */}
        <div className="card" style={{ padding: '1rem', marginBottom: '1.25rem', opacity: admin ? 1 : 0.7 }}>
          <div style={{ marginBottom: '0.75rem', fontSize: '0.78rem', fontWeight: 600 }}>Weight Class</div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            {Object.entries(weightClasses).map(([key, wci]) => {
              const wcColor = WC_ICONS[key]?.color || 'var(--accent)'
              return (
              <button key={key} onClick={() => admin && setSelectedWC(key)} disabled={!admin}
                style={{
                  padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)',
                  border: selectedWC === key ? `2px solid ${wcColor}` : '1px solid var(--border)',
                  background: selectedWC === key ? wcColor : 'var(--bg-card)',
                  color: selectedWC === key ? '#fff' : 'var(--text-primary)',
                  cursor: admin ? 'pointer' : 'default', fontSize: '0.76rem', fontWeight: 500,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem', minWidth: '90px',
                }}>
                {WC_ICONS[key] ? (() => { const { icon: Icon, color } = WC_ICONS[key]; return <Icon size={20} style={{ color: selectedWC === key ? '#fff' : color }} /> })() : null}
                <span>{wci.label}</span>
                <span style={{ fontSize: '0.65rem', opacity: 0.8 }}>{wci.min}-{wci.max} fighters</span>
              </button>
              )
            })}
          </div>

          {/* Fight Mode */}
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Fight Style</div>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {FIGHT_MODES.map(m => {
                const Icon = m.icon
                return (
                  <button key={m.id} onClick={() => admin && setFightMode(m.id)} disabled={!admin}
                    style={{
                      padding: '0.35rem 0.6rem', borderRadius: 'var(--radius)',
                      border: fightMode === m.id ? `2px solid ${m.color}` : '1px solid var(--border)',
                      background: fightMode === m.id ? `${m.color}15` : 'var(--bg-card)',
                      color: fightMode === m.id ? m.color : 'var(--text-secondary)',
                      cursor: admin ? 'pointer' : 'default', fontSize: '0.72rem', fontWeight: 500,
                      display: 'flex', alignItems: 'center', gap: '0.3rem',
                    }}>
                    <Icon size={12} /> {m.label}
                  </button>
                )
              })}
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              {FIGHT_MODES.find(m => m.id === fightMode)?.desc}
            </div>
          </div>

          {/* Scenario category (for fixed mode) */}
          {fightMode === 'fixed' && scenarios.length > 0 && (
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Scenario Category</div>
              <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                <button onClick={() => admin && setScenarioCategory('')} disabled={!admin}
                  style={{
                    padding: '0.25rem 0.5rem', borderRadius: 'var(--radius)', fontSize: '0.7rem',
                    border: !scenarioCategory ? '1px solid var(--accent)' : '1px solid var(--border)',
                    background: !scenarioCategory ? 'var(--accent)' : 'var(--bg-card)',
                    color: !scenarioCategory ? '#fff' : 'var(--text-secondary)', cursor: admin ? 'pointer' : 'default',
                  }}>
                  All ({scenarios.length})
                </button>
                {scenarioCategories.map(cat => (
                  <button key={cat} onClick={() => admin && setScenarioCategory(cat)} disabled={!admin}
                    style={{
                      padding: '0.25rem 0.5rem', borderRadius: 'var(--radius)', fontSize: '0.7rem',
                      border: scenarioCategory === cat ? '1px solid var(--accent)' : '1px solid var(--border)',
                      background: scenarioCategory === cat ? 'var(--accent)' : 'var(--bg-card)',
                      color: scenarioCategory === cat ? '#fff' : 'var(--text-secondary)', cursor: admin ? 'pointer' : 'default',
                    }}>
                    {cat} ({scenarios.filter(s => s.category === cat).length})
                  </button>
                ))}
              </div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                {filteredScenarios.length} scenarios selected — each bout runs all {filteredScenarios.length} rounds
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
            {[
              { label: 'Fighters', value: numUsers, set: setNumUsers, min: 1, max: activeUserCount, w: '70px' },
              { label: 'xPower', value: windowsPerUser, set: setWindowsPerUser, min: 1, max: 20, w: '70px' },
              ...(fightMode !== 'fixed' ? [{ label: 'Rounds', value: turnsPerSession, set: setTurnsPerSession, min: 1, max: 10, w: '70px' }] : []),
              { label: 'Ramp-up (s)', value: rampUpS, set: setRampUpS, min: 0, max: 120, w: '70px', step: 5 },
              { label: 'Interval (s)', value: intervalS, set: setIntervalS, min: 0, max: 30, w: '70px', step: 1 },
            ].map(f => (
              <div key={f.label}>
                <label style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.2rem' }}>{f.label}</label>
                <input type="number" min={f.min} max={f.max} step={f.step || 1} disabled={!admin}
                  value={f.value} onChange={e => f.set(parseFloat(e.target.value) || f.min)}
                  style={{ width: f.w, padding: '0.35rem 0.5rem', fontSize: '0.8rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }} />
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={handleLaunch} className="primary" disabled={!admin || launching || activeUserCount === 0}
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              {launching
                ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Fighting...</>
                : <><Play size={14} /> Start {wc.label || 'Fight'}</>}
            </button>
            <span style={{ fontSize: '0.73rem', color: (boutsExceedMax || boutsBelowMin) ? 'var(--orange)' : 'var(--text-secondary)' }}>
              {numUsers} fighters x {windowsPerUser} xPower = <strong>{totalSessions} bouts</strong>
              {fightMode === 'fixed'
                ? <> x {filteredScenarios.length || turnsPerSession} rounds</>
                : <> x {turnsPerSession} rounds</>
              }
            </span>
          </div>

          {(boutsExceedMax || boutsBelowMin) && (
            <div style={{ marginTop: '0.35rem', fontSize: '0.72rem', color: 'var(--orange)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <AlertCircle size={12} />
              {boutsExceedMax
                ? <>{totalSessions} bouts exceeds {wc.label} max ({wc.max}){actualWC && actualWC !== selectedWC ? <> — that's actually <strong>{weightClasses[actualWC]?.label}</strong> territory</> : null}</>
                : <>{totalSessions} bouts is below {wc.label} min ({wc.min}){actualWC && actualWC !== selectedWC ? <> — that's actually <strong>{weightClasses[actualWC]?.label}</strong> territory</> : null}</>
              }
            </div>
          )}

          {activeUserCount === 0 && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: 'var(--red)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              No fighters in camp.
              <button onClick={() => navigate('/load-test/fighters')}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 600, padding: 0, textDecoration: 'underline' }}>
                Scout talent first
              </button>
            </div>
          )}
        </div>

      {/* Live fight monitor */}
      {activeFight && (
        <div className="card" style={{ padding: '1rem', marginBottom: '1.25rem', border: activeFight.status === 'running' ? '1px solid var(--blue)' : '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {WC_ICONS[activeFight.weight_class] ? (() => { const { icon: Icon, color } = WC_ICONS[activeFight.weight_class]; return <Icon size={18} style={{ color }} /> })() : null}
              <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{activeFight.weight_class_label || activeFight.weight_class}</span>
              <StatusBadge status={activeFight.status} />
              {activeFight.config && (
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                  {activeFight.config.num_users} fighters x {activeFight.config.windows_per_user} xPower = {activeFight.config.total_sessions} bouts
                  {activeFight.config.fight_mode && <> ({activeFight.config.fight_mode})</>}
                </span>
              )}
            </div>
            {activeFight.duration_s > 0 && (
              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Timer size={11} /> {formatSec(activeFight.duration_s)}
              </span>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <StatCard label="Completed" value={prog.completed || 0} color="var(--green)" />
            <StatCard label="Running" value={prog.running || 0} color="var(--blue)" />
            <StatCard label="Errors" value={prog.errors || 0} color="var(--red)" />
            <StatCard label="Total Rounds" value={prog.total_turns || 0} />
            {activeFight.throughput && (
              <StatCard label="Throughput" value={`${activeFight.throughput.turns_per_second || 0}`} sub="rounds/s" />
            )}
            <StatCard label="Error Rate" value={`${((activeFight.error_rate || 0) * 100).toFixed(1)}%`}
              color={activeFight.error_rate > 0.1 ? 'var(--red)' : 'var(--green)'} />
          </div>

          {lat.avg_ttfb_ms > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>TTFT</div>
                <LatencyBar label="Avg" value={lat.avg_ttfb_ms} />
                <LatencyBar label="P95" value={lat.p95_ttfb_ms} />
                <LatencyBar label="Max" value={lat.max_ttfb_ms} />
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Full Answer</div>
                <LatencyBar label="Avg" value={lat.avg_total_ms} />
                <LatencyBar label="P95" value={lat.p95_total_ms} />
                <LatencyBar label="Max" value={lat.max_total_ms} />
              </div>
              {activeFight.benchmark
                ? <BenchmarkPanel benchmark={activeFight.benchmark} />
                : <QualityPanel quality={activeFight.quality} />
              }
            </div>
          )}

          <SessionTable sessions={activeFight.sessions} />
        </div>
      )}

      {/* Cross-load comparison */}
      {comparison && comparison.summary && comparison.summary.total_runs > 0 && (
        <div className="card" style={{ padding: '0.75rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>Cross-Load Trend</span>
            {comparison.summary.trend === 'improving' && <TrendingDown size={14} style={{ color: 'var(--green)' }} />}
            {comparison.summary.trend === 'degrading' && <TrendingUp size={14} style={{ color: 'var(--red)' }} />}
            {comparison.summary.trend === 'stable' && <Minus size={14} style={{ color: 'var(--text-muted)' }} />}
            <span style={{ fontSize: '0.72rem', color: comparison.summary.trend === 'improving' ? 'var(--green)' : comparison.summary.trend === 'degrading' ? 'var(--red)' : 'var(--text-muted)', fontWeight: 500 }}>
              {comparison.summary.trend}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.5rem', fontSize: '0.72rem' }}>
            <div><span style={{ color: 'var(--text-secondary)' }}>Runs:</span> {comparison.summary.total_runs}</div>
            <div><span style={{ color: 'var(--text-secondary)' }}>Avg TTFT:</span> {formatMs(comparison.summary.avg_ttfb_ms)}</div>
            <div><span style={{ color: 'var(--text-secondary)' }}>Avg P95 TTFT:</span> {formatMs(comparison.summary.avg_p95_ttfb_ms)}</div>
            <div><span style={{ color: 'var(--text-secondary)' }}>Avg Total:</span> {formatMs(comparison.summary.avg_total_ms)}</div>
            <div><span style={{ color: 'var(--text-secondary)' }}>Avg Throughput:</span> {comparison.summary.avg_throughput} rnd/s</div>
            <div><span style={{ color: 'var(--text-secondary)' }}>Avg Error Rate:</span> {(comparison.summary.avg_error_rate * 100).toFixed(1)}%</div>
            {comparison.summary.avg_quality && (
              <>
                <div><span style={{ color: 'var(--text-secondary)' }}>Resp Rate:</span> {(comparison.summary.avg_quality.response_rate * 100).toFixed(1)}%</div>
                <div><span style={{ color: 'var(--text-secondary)' }}>Completion:</span> {(comparison.summary.avg_quality.completion_rate * 100).toFixed(1)}%</div>
                <div><span style={{ color: 'var(--text-secondary)' }}>Tool Use:</span> {(comparison.summary.avg_quality.tool_engagement * 100).toFixed(1)}%</div>
              </>
            )}
          </div>
        </div>
      )}

      {/* History */}
      <div className="card" style={{ overflow: 'auto' }}>
        <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>Fight History</span>
          <button onClick={loadHistory} className="secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem' }}>
            <RefreshCw size={11} /> Refresh
          </button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Class</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Config</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Status</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Bouts</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Avg TTFT</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>P95 TTFT</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Duration</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Grade</th>
              <th style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Date</th>
              {admin && <th style={{ padding: '0.5rem 0.75rem' }}></th>}
            </tr>
          </thead>
          <tbody>
            {history.length === 0 && (
              <tr><td colSpan={admin ? 10 : 9} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                No superfight history
              </td></tr>
            )}
            {history.map(f => {
              const fLat = f.latency || {}
              const cfg = f.config || {}
              return (
                <tr key={f.id}
                  style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', background: expandedFight === f.id ? 'var(--bg-primary)' : 'transparent' }}
                  onClick={() => {
                    if (expandedFight === f.id) {
                      setExpandedFight(null)
                      setExpandedFightData(null)
                    } else {
                      setExpandedFight(f.id)
                      setExpandedFightData(null)
                      getSuperfight(f.id).then(d => setExpandedFightData(d)).catch(() => {})
                    }
                  }}>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    {WC_ICONS[f.weight_class] ? (() => { const { icon: Icon, color } = WC_ICONS[f.weight_class]; return <Icon size={13} style={{ verticalAlign: 'middle', marginRight: '0.3rem', color }} /> })() : null}
                    {f.weight_class}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                    {cfg.num_users || '?'}f x {cfg.windows_per_user || '?'}xP
                    {cfg.fight_mode && <span style={{ marginLeft: '0.3rem', opacity: 0.7 }}>({cfg.fight_mode})</span>}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem' }}><StatusBadge status={f.status} /></td>
                  <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace' }}>
                    <span style={{ color: 'var(--green)' }}>{f.completed}</span>/{f.total_fighters}
                    {f.errors > 0 && <span style={{ color: 'var(--red)', marginLeft: '0.3rem' }}>({f.errors}err)</span>}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                    {fLat.avg_ttfb_ms > 0 ? formatMs(fLat.avg_ttfb_ms) : '-'}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                    {fLat.p95_ttfb_ms > 0 ? formatMs(fLat.p95_ttfb_ms) : '-'}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                    {f.duration_s > 0 ? formatSec(f.duration_s) : '-'}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    {f.benchmark ? (
                      <span style={{ fontWeight: 700, fontSize: '0.8rem', color: f.benchmark.grade_color }}>
                        {f.benchmark.grade} <span style={{ fontWeight: 400, fontSize: '0.68rem' }}>{f.benchmark.overall_score}/5</span>
                      </span>
                    ) : <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>—</span>}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                    {formatDt(f.created_at)}
                  </td>
                  {admin && (
                    <td style={{ padding: '0.5rem 0.75rem' }}>
                      {f.status !== 'running' && (
                        <button onClick={e => { e.stopPropagation(); handleDelete(f.id) }}
                          style={{ padding: '0.2rem', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
                          <Trash2 size={12} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>

        {expandedFight && (() => {
          const f = history.find(h => h.id === expandedFight)
          if (!f) return null
          const fLat = f.latency || {}
          const sessions = expandedFightData?.sessions || expandedFightData?.sessions_data || []
          return (
            <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <div>
                  <LatencyBar label="Avg TTFT" value={fLat.avg_ttfb_ms || 0} />
                  <LatencyBar label="P95 TTFT" value={fLat.p95_ttfb_ms || 0} />
                </div>
                <div>
                  <LatencyBar label="Avg Total" value={fLat.avg_total_ms || 0} />
                  <LatencyBar label="P95 Total" value={fLat.p95_total_ms || 0} />
                </div>
                {(f.benchmark || expandedFightData?.benchmark)
                  ? <BenchmarkPanel benchmark={f.benchmark || expandedFightData?.benchmark} />
                  : <QualityPanel quality={f.quality || expandedFightData?.quality} />
                }
              </div>
              {!expandedFightData && (
                <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                  <span className="spinner" style={{ width: 12, height: 12, marginRight: '0.3rem' }} /> Loading bouts...
                </div>
              )}
              {sessions.length > 0 && <SessionTable sessions={sessions} />}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
