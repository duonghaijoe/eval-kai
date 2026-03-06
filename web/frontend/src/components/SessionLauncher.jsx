import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Flame, Compass, GitMerge, FileCheck, Zap, ChevronRight, PlayCircle, Layers } from 'lucide-react'
import { startSession, getScenarios, getConfig, createMatch } from '../api'

const MODES = [
  { id: 'fire', label: 'Fire', desc: 'Autonomous AI actor — fire and forget', icon: Flame, color: 'var(--red)' },
  { id: 'explore', label: 'Explore', desc: 'AI decides each exchange dynamically', icon: Compass, color: 'var(--katalon-teal)' },
  { id: 'hybrid', label: 'Hybrid', desc: 'AI-generated plan, adapted per exchange', icon: GitMerge, color: 'var(--orange)' },
  { id: 'fixed', label: 'Fixed', desc: 'Predefined scenarios for regression', icon: FileCheck, color: 'var(--green)' },
]

export default function SessionLauncher() {
  const [mode, setMode] = useState('explore')
  const [goal, setGoal] = useState('')
  const [scenarioId, setScenarioId] = useState('')
  const [fixedCategory, setFixedCategory] = useState('')
  const [maxTurns, setMaxTurns] = useState(10)
  const [maxTime, setMaxTime] = useState(600)
  const [evalModel, setEvalModel] = useState('')
  const [scenarios, setScenarios] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    getScenarios().then(d => setScenarios(d.scenarios || [])).catch(() => {})
    getConfig().then(d => setEvalModel(d.eval_model || 'claude-sonnet-4-6')).catch(() => {})
  }, [])

  const categories = useMemo(() => {
    const cats = [...new Set(scenarios.map(s => s.category))]
    return cats.sort()
  }, [scenarios])

  const filteredScenarios = useMemo(() => {
    if (!fixedCategory) return scenarios
    return scenarios.filter(s => s.category === fixedCategory)
  }, [scenarios, fixedCategory])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await startSession({
        actorMode: mode,
        goal: mode !== 'fixed' ? goal : scenarios.find(s => s.id === scenarioId)?.description,
        scenarioId: mode === 'fixed' ? scenarioId : undefined,
        maxTurns: mode === 'fixed' ? undefined : maxTurns,
        maxTimeS: maxTime,
        evalModel,
      })
      navigate(`/sessions/${res.session_id}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleRunAll = async () => {
    setError(null)
    setLoading(true)
    try {
      const res = await createMatch({
        category: fixedCategory || null,
        maxTimeS: maxTime,
        evalModel,
      })
      navigate(`/matches/${res.match_id}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const selectedScenario = scenarios.find(s => s.id === scenarioId)

  return (
    <div>
      <div className="page-header">
        <h2><Zap size={20} /> New Match</h2>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="card">
          <h3>Fighter Mode</h3>
          <div className="mode-grid">
            {MODES.map(m => {
              const Icon = m.icon
              return (
                <div
                  key={m.id}
                  className={`mode-card ${mode === m.id ? 'selected' : ''}`}
                  onClick={() => setMode(m.id)}
                >
                  <div className="mode-icon" style={{ color: m.color }}><Icon size={20} /></div>
                  <div className="mode-label">{m.label}</div>
                  <div className="mode-desc">{m.desc}</div>
                </div>
              )
            })}
          </div>
        </div>

        {mode === 'fire' && (
          <div className="card">
            <h3><Flame size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Fire &amp; Forget — Fight Goal</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              AI actor will autonomously drive the full bout with Kai, score each exchange, and produce a scorecard.
            </p>
            <textarea
              value={goal}
              onChange={e => setGoal(e.target.value)}
              placeholder="e.g., Test Kai's ability to generate test cases from requirements"
              rows={3}
              required
            />
            <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {[
                'Smoke test: greeting, test results, generate test cases',
                'Test Kai\'s context retention across 6 follow-up exchanges',
                'Edge cases: ambiguous requests, out-of-scope, special characters',
                'Stress test: rapid topic switching across 8 exchanges',
              ].map(preset => (
                <button key={preset} type="button" onClick={() => setGoal(preset)}
                  style={{ fontSize: '0.7rem', padding: '0.25em 0.5em' }}>
                  {preset.slice(0, 55)}...
                </button>
              ))}
            </div>
          </div>
        )}

        {(mode === 'explore' || mode === 'hybrid') && (
          <div className="card">
            <h3>Fight Goal</h3>
            <textarea
              value={goal}
              onChange={e => setGoal(e.target.value)}
              placeholder="e.g., Test Kai's ability to generate test cases from requirements"
              rows={3}
              required
            />
            <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {[
                'Test Kai\'s ability to generate test cases from requirements',
                'Test Kai\'s context retention across multiple exchanges',
                'Test Kai\'s error handling with invalid requests',
                'Test Kai\'s project insights and analytics capabilities',
              ].map(preset => (
                <button key={preset} type="button" onClick={() => setGoal(preset)}
                  style={{ fontSize: '0.7rem', padding: '0.25em 0.5em' }}>
                  {preset.slice(0, 50)}...
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === 'fixed' && (
          <div className="card">
            <h3><FileCheck size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Scenarios</h3>

            {/* Category filter */}
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              <button type="button"
                className={!fixedCategory ? 'primary' : ''}
                onClick={() => setFixedCategory('')}
                style={{ fontSize: '0.7rem', padding: '0.25em 0.6em' }}>
                All ({scenarios.length})
              </button>
              {categories.map(cat => {
                const count = scenarios.filter(s => s.category === cat).length
                return (
                  <button key={cat} type="button"
                    className={fixedCategory === cat ? 'primary' : ''}
                    onClick={() => setFixedCategory(cat)}
                    style={{ fontSize: '0.7rem', padding: '0.25em 0.6em' }}>
                    {cat} ({count})
                  </button>
                )
              })}
            </div>

            {/* Scenario selector */}
            <select value={scenarioId} onChange={e => setScenarioId(e.target.value)}>
              <option value="">Select a scenario for single round...</option>
              {filteredScenarios.map(s => (
                <option key={s.id} value={s.id}>
                  [{s.category}] {s.name} ({s.steps.length} exchanges)
                </option>
              ))}
            </select>

            {/* Scenario preview */}
            {selectedScenario && (
              <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <div><strong>{selectedScenario.name}</strong> — {selectedScenario.description}</div>
                <div style={{ marginTop: '0.5rem' }}>
                  {selectedScenario.steps.map((s, i) => (
                    <div key={i} style={{ marginTop: '0.25rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'flex-start', gap: '0.35rem' }}>
                      <ChevronRight size={12} style={{ marginTop: '0.15rem', flexShrink: 0 }} />
                      <span>{s.message.slice(0, 100)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Scenario count summary */}
            <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.75rem', background: 'var(--bg-primary)', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              <Layers size={13} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
              <strong>{filteredScenarios.length}</strong> rounds
              {fixedCategory && <> in <strong>{fixedCategory}</strong></>}
              {' '}— {filteredScenarios.reduce((sum, s) => sum + s.steps.length, 0)} total exchanges
            </div>
          </div>
        )}

        <div className="card">
          <h3>Ring Settings</h3>
          <div className="form-row">
            {mode !== 'fixed' && (
              <div>
                <label>Max Exchanges</label>
                <input type="number" value={maxTurns} onChange={e => setMaxTurns(+e.target.value)} min={1} max={50} />
              </div>)}
            <div>
              <label>Time Limit (seconds)</label>
              <input type="number" value={maxTime} onChange={e => setMaxTime(+e.target.value)} min={60} max={3600} />
            </div>
            <div>
              <label>Judge Model</label>
              <select value={evalModel} onChange={e => setEvalModel(e.target.value)}>
                <option value="claude-sonnet-4-6">Sonnet 4.6 (fast)</option>
                <option value="claude-opus-4-6">Opus 4.6 (deep analysis)</option>
              </select>
            </div>
          </div>
        </div>

        {error && (
          <div className="card" style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>
            {error}
          </div>
        )}

        <div className="form-actions">
          {mode === 'fixed' ? (
            <>
              <button type="submit" className="primary" disabled={loading || !scenarioId}>
                {loading ? <><span className="spinner" /> Starting...</> : <><PlayCircle size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Run Single Round</>}
              </button>
              <button type="button" onClick={handleRunAll} disabled={loading}
                style={{ background: 'var(--green)', borderColor: 'var(--green)', color: 'white' }}>
                {loading ? <><span className="spinner" /> Starting...</> : <><Layers size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Full Match — {fixedCategory || 'All'} ({filteredScenarios.length} rounds)</>}
              </button>
            </>
          ) : (
            <button type="submit" className="primary" disabled={loading}>
              {loading ? <><span className="spinner" /> Starting...</> : <><Zap size={14} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Start Round</>}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
