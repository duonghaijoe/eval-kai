import { useState, useEffect } from 'react'
import { BookOpen, RotateCcw, Save, ChevronDown, ChevronRight, Timer, Target, Brain, Shield, Star, MessageSquare, CheckCircle, Wrench, Zap, Lock } from 'lucide-react'
import { getRubric, updateRubric, resetRubric } from '../api'
import { useAdmin } from '../App'

const DIMENSION_ICONS = {
  relevance: MessageSquare,
  accuracy: CheckCircle,
  helpfulness: Star,
  tool_usage: Wrench,
  latency: Timer,
  goal_achievement: Target,
  context_retention: Brain,
  error_handling: Shield,
  response_quality: Star,
}

function DimensionEditor({ dimKey, dim, onChange, isLatency, readOnly }) {
  const [expanded, setExpanded] = useState(false)
  const Icon = DIMENSION_ICONS[dimKey] || Star

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: '6px', marginBottom: '0.5rem', overflow: 'hidden' }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.75rem',
          cursor: 'pointer', background: expanded ? 'var(--bg-primary)' : 'transparent',
          transition: 'background 0.15s',
        }}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Icon size={14} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{dim.name}</span>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
          weight: {dim.weight || 1.0}
          {dim.auto_score && <span className="badge completed" style={{ marginLeft: '0.3rem' }}>auto</span>}
        </span>
      </div>

      {expanded && (
        <div style={{ padding: '0.5rem 0.75rem 0.75rem', fontSize: '0.8rem' }}>
          <div style={{ marginBottom: '0.5rem' }}>
            <label>Description</label>
            <input
              value={dim.description || ''}
              onChange={e => onChange({ ...dim, description: e.target.value })}
              style={{ fontSize: '0.8rem' }}
              disabled={readOnly}
            />
          </div>

          <div style={{ marginBottom: '0.5rem' }}>
            <label>Weight</label>
            <input
              type="number"
              value={dim.weight || 1.0}
              onChange={e => onChange({ ...dim, weight: parseFloat(e.target.value) || 1.0 })}
              min={0.1} max={5} step={0.1}
              style={{ width: '80px', fontSize: '0.8rem' }}
              disabled={readOnly}
            />
          </div>

          {/* Score descriptions */}
          <div style={{ marginTop: '0.5rem' }}>
            <label style={{ marginBottom: '0.35rem' }}>Score Definitions</label>
            {[5, 4, 3, 2, 1].map(score => (
              <div key={score} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.3rem' }}>
                <span style={{
                  width: '22px', height: '22px', borderRadius: '4px', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700,
                  background: score >= 4 ? 'rgba(22,163,74,0.1)' : score >= 3 ? 'rgba(202,138,4,0.1)' : 'rgba(220,38,38,0.1)',
                  color: score >= 4 ? 'var(--green)' : score >= 3 ? 'var(--yellow)' : 'var(--red)',
                }}>
                  {score}
                </span>
                <input
                  value={(dim.scores || {})[String(score)] || ''}
                  onChange={e => {
                    const scores = { ...(dim.scores || {}) }
                    scores[String(score)] = e.target.value
                    onChange({ ...dim, scores })
                  }}
                  style={{ flex: 1, fontSize: '0.75rem', padding: '0.3em 0.5em' }}
                  placeholder={`Score ${score} description...`}
                  disabled={readOnly}
                />
              </div>
            ))}
          </div>

          {/* Latency thresholds */}
          {isLatency && dim.thresholds && (
            <div style={{ marginTop: '0.75rem' }}>
              <label style={{ marginBottom: '0.35rem' }}>Latency Thresholds (ms)</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: '0.3rem', alignItems: 'center', fontSize: '0.75rem' }}>
                <span style={{ fontWeight: 600 }}>Score</span>
                <span style={{ fontWeight: 600 }}>TTFT max</span>
                <span style={{ fontWeight: 600 }}>Total max</span>
                {[5, 4, 3, 2].map(score => (
                  <>
                    <span key={`label-${score}`} style={{
                      fontWeight: 600,
                      color: score >= 4 ? 'var(--green)' : score >= 3 ? 'var(--yellow)' : 'var(--red)',
                    }}>{score}</span>
                    <input
                      key={`ttfb-${score}`}
                      type="number"
                      value={dim.thresholds.ttfb_ms?.[String(score)] || ''}
                      onChange={e => {
                        const th = { ...dim.thresholds }
                        th.ttfb_ms = { ...th.ttfb_ms, [String(score)]: parseInt(e.target.value) || 0 }
                        onChange({ ...dim, thresholds: th })
                      }}
                      style={{ fontSize: '0.75rem', padding: '0.25em 0.4em' }}
                      disabled={readOnly}
                    />
                    <input
                      key={`total-${score}`}
                      type="number"
                      value={dim.thresholds.total_ms?.[String(score)] || ''}
                      onChange={e => {
                        const th = { ...dim.thresholds }
                        th.total_ms = { ...th.total_ms, [String(score)]: parseInt(e.target.value) || 0 }
                        onChange({ ...dim, thresholds: th })
                      }}
                      style={{ fontSize: '0.75rem', padding: '0.25em 0.4em' }}
                      disabled={readOnly}
                    />
                  </>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function RubricSettings() {
  const { admin, setAdmin } = useAdmin()
  const [rubric, setRubric] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getRubric().then(d => { setRubric(d); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const isAdmin = !!admin

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const updated = await updateRubric(rubric)
      setRubric(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      if (e.message.includes('login required') || e.message.includes('expired')) {
        setAdmin(null)
      }
      alert('Failed to save: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    if (!confirm('Reset judging criteria to defaults? This cannot be undone.')) return
    try {
      const defaults = await resetRubric()
      setRubric(defaults)
    } catch (e) {
      if (e.message.includes('login required') || e.message.includes('expired')) {
        setAdmin(null)
      }
      alert('Failed to reset: ' + e.message)
    }
  }

  const updateTurnDim = (key, dim) => {
    setRubric(r => ({
      ...r,
      turn_dimensions: { ...r.turn_dimensions, [key]: dim },
    }))
  }

  const updateSessionDim = (key, dim) => {
    setRubric(r => ({
      ...r,
      session_dimensions: { ...r.session_dimensions, [key]: dim },
    }))
  }

  if (loading) return <div className="loading-text"><span className="spinner" /> Loading judging criteria...</div>
  if (!rubric) return <div className="empty">Failed to load judging criteria</div>

  return (
    <div>
      <div className="page-header">
        <h2><BookOpen size={20} /> Judging Criteria</h2>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {isAdmin ? (
            <>
              <button onClick={handleReset} title="Reset to defaults">
                <RotateCcw size={14} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} />
                Reset
              </button>
              <button className="primary" onClick={handleSave} disabled={saving}>
                {saving
                  ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Saving...</>
                  : saved
                    ? <><CheckCircle size={14} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} /> Saved</>
                    : <><Save size={14} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} /> Save Changes</>
                }
              </button>
            </>
          ) : (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <Lock size={12} /> Sign in to edit
            </span>
          )}
        </div>
      </div>

      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        Configure judging criteria for AI scorecards. Each dimension is scored 1-5 based on the descriptions below.
        Latency is auto-scored from thresholds. Weights affect the overall scorecard calculation.
      </div>

      {/* Turn-level dimensions */}
      <div className="card">
        <h3><Zap size={13} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />Per-Exchange Dimensions</h3>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          Applied to each individual exchange in a round.
        </div>
        {Object.entries(rubric.turn_dimensions || {}).map(([key, dim]) => (
          <DimensionEditor
            key={key}
            dimKey={key}
            dim={dim}
            onChange={d => updateTurnDim(key, d)}
            isLatency={key === 'latency'}
            readOnly={!isAdmin}
          />
        ))}
      </div>

      {/* Session-level dimensions */}
      <div className="card">
        <h3><Target size={13} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />Round-Level Dimensions</h3>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          Applied to the overall round scorecard after all exchanges complete.
        </div>
        {Object.entries(rubric.session_dimensions || {}).map(([key, dim]) => (
          <DimensionEditor
            key={key}
            dimKey={key}
            dim={dim}
            onChange={d => updateSessionDim(key, d)}
            isLatency={false}
            readOnly={!isAdmin}
          />
        ))}
      </div>
    </div>
  )
}
