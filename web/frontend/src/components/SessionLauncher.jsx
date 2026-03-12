import { useState, useEffect, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Flame, Compass, GitMerge, FileCheck, Zap, ChevronRight, PlayCircle, Layers, Save, CheckCircle, Plus, Trash2, Send, MessageSquare, BookOpen } from 'lucide-react'
import { startSession, getScenarios, getConfig, createMatch, updateConfig, submitScenario } from '../api'
import { useAdmin } from '../AdminContext'

const MODES = [
  { id: 'fire', label: 'Fire', desc: 'Autonomous AI actor — fire and forget', icon: Flame, color: 'var(--red)' },
  { id: 'explore', label: 'Explore', desc: 'AI decides each exchange dynamically', icon: Compass, color: 'var(--katalon-teal)' },
  { id: 'hybrid', label: 'Hybrid', desc: 'AI-generated plan, adapted per exchange', icon: GitMerge, color: 'var(--orange)' },
  { id: 'fixed', label: 'Fixed', desc: 'Predefined scenarios for regression', icon: FileCheck, color: 'var(--green)' },
]

export default function SessionLauncher() {
  const { admin } = useAdmin()
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
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    getScenarios().then(d => setScenarios(d.scenarios || [])).catch(() => {})
    getConfig().then(d => {
      setEvalModel(d.eval_model || 'claude-sonnet-4-6')
      if (d.default_max_turns) setMaxTurns(d.default_max_turns)
      if (d.default_max_time) setMaxTime(d.default_max_time)
    }).catch(() => {})
  }, [])

  const handleSaveDefaults = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await updateConfig({ default_max_turns: maxTurns, default_max_time: maxTime, eval_model: evalModel })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {} finally { setSaving(false) }
  }

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

  const handleQuickTest = async () => {
    setError(null)
    setLoading(true)
    try {
      const res = await startSession({
        actorMode: 'explore',
        goal: 'Ask Kai: what is the current project name and project id? Verify the response matches the expected environment configuration.',
        maxTurns: 1,
        maxTimeS: 120,
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

  // Submission form state
  const [showSubmit, setShowSubmit] = useState(false)
  const [subName, setSubName] = useState('')
  const [subDesc, setSubDesc] = useState('')
  const [subCategory, setSubCategory] = useState('happy')
  const [subTags, setSubTags] = useState('')
  const [subRequester, setSubRequester] = useState('')
  const [subSteps, setSubSteps] = useState([{ name: 'Step 1', message: '' }])
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const addStep = () => setSubSteps([...subSteps, { name: `Step ${subSteps.length + 1}`, message: '' }])
  const removeStep = (i) => setSubSteps(subSteps.filter((_, idx) => idx !== i))
  const updateStep = (i, field, val) => {
    const copy = [...subSteps]
    copy[i] = { ...copy[i], [field]: val }
    setSubSteps(copy)
  }

  const handleSubmitScenario = async () => {
    if (!subName.trim() || !subDesc.trim() || subSteps.every(s => !s.message.trim())) return
    setSubmitting(true)
    try {
      await submitScenario({
        name: subName,
        description: subDesc,
        category: subCategory,
        steps: subSteps.filter(s => s.message.trim()),
        tags: subTags ? subTags.split(',').map(t => t.trim()).filter(Boolean) : [],
        submitted_by: subRequester.trim() || 'anonymous',
      })
      setSubmitted(true)
      setSubName(''); setSubDesc(''); setSubCategory('happy'); setSubTags(''); setSubRequester('')
      setSubSteps([{ name: 'Step 1', message: '' }])
      setTimeout(() => { setSubmitted(false); setShowSubmit(false) }, 2500)
    } catch (e) {
      alert('Failed: ' + e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2><Zap size={20} /> New Match</h2>
      </div>

      {/* Quick Test — Spotlight */}
      <div className="card" style={{
        background: 'linear-gradient(135deg, var(--katalon-teal), #00695c)',
        color: 'white',
        padding: '1.5rem 2rem',
        borderRadius: 'var(--radius)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1.5rem',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
            <Zap size={22} />
            <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'white' }}>Quick Test</h3>
          </div>
          <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.9 }}>
            Send a greeting to Kai and get a scored report in seconds. Perfect for a quick health check.
          </p>
        </div>
        <button
          type="button"
          onClick={handleQuickTest}
          disabled={loading}
          style={{
            background: 'rgba(255,255,255,0.2)',
            borderColor: 'rgba(255,255,255,0.4)',
            color: 'white',
            whiteSpace: 'nowrap',
            padding: '0.65rem 1.5rem',
            fontSize: '0.95rem',
            fontWeight: 600,
            backdropFilter: 'blur(4px)',
          }}
        >
          {loading ? <><span className="spinner" /> Starting...</> : <><Zap size={16} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} />Run Quick Test</>}
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="card">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            Fighter Mode
            <Link to="/guideline#fight-modes" style={{ fontSize: '0.7rem', color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.2rem', fontWeight: 400 }}>
              <BookOpen size={12} /> Under the Hood
            </Link>
          </h3>
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
                  [{s.category}] {s.name} ({s.steps.length} exchanges){s.source === 'custom' ? ' ★' : ''}
                </option>
              ))}
            </select>

            {/* Scenario preview */}
            {selectedScenario && (
              <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <div>
                  <strong>{selectedScenario.name}</strong> — {selectedScenario.description}
                  {selectedScenario.source === 'custom' && (
                    <span style={{ marginLeft: '0.4rem', fontSize: '0.62rem', padding: '0.1em 0.35em', background: 'var(--accent)', color: '#fff', borderRadius: 3 }}>community</span>
                  )}
                </div>
                <div style={{ marginTop: '0.5rem' }}>
                  {selectedScenario.steps.map((s, i) => (
                    <div key={i} style={{ marginTop: '0.25rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'flex-start', gap: '0.35rem' }}>
                      <ChevronRight size={12} style={{ marginTop: '0.15rem', flexShrink: 0 }} />
                      <span>
                        {s.message.split(/(\[.*?\])/).map((part, j) =>
                          part.startsWith('[') && part.endsWith(']')
                            ? <span key={j} style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.72rem', opacity: 0.7 }}>{part}</span>
                            : <span key={j}>{part}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Scenario count summary */}
            <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.75rem', background: 'var(--bg-primary)', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                <Layers size={13} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
                <strong>{filteredScenarios.length}</strong> rounds
                {fixedCategory && <> in <strong>{fixedCategory}</strong></>}
                {' '}— {filteredScenarios.reduce((sum, s) => sum + s.steps.length, 0)} total exchanges
              </span>
              <button type="button" onClick={() => setShowSubmit(!showSubmit)}
                style={{ fontSize: '0.72rem', padding: '0.25em 0.6em', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <MessageSquare size={12} /> Suggest Scenario
              </button>
            </div>

            {/* Scenario Submission Form */}
            {showSubmit && (
              <div style={{ marginTop: '0.75rem', padding: '1rem', background: 'var(--bg-primary)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <h4 style={{ fontSize: '0.85rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <Send size={14} /> Suggest a New Scenario
                </h4>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                  Submit a scenario for review. Once approved by an admin, it becomes available in Fixed mode for everyone.
                  Use <code style={{ background: 'var(--bg-hover)', padding: '0.1em 0.3em', borderRadius: 3 }}>[brackets]</code> in messages for notes — they'll be stripped before sending to Kai.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>Scenario Name</label>
                    <input value={subName} onChange={e => setSubName(e.target.value)}
                      placeholder="e.g., Test Cloud Configuration Check" style={{ fontSize: '0.78rem', width: '100%' }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <div>
                      <label style={{ fontSize: '0.72rem', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>Category</label>
                      <select value={subCategory} onChange={e => setSubCategory(e.target.value)} style={{ fontSize: '0.78rem', width: '100%' }}>
                        {['happy', 'edge', 'multi-turn', 'stress', 'functional', 'guardrails'].map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.72rem', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>Tags</label>
                      <input value={subTags} onChange={e => setSubTags(e.target.value)}
                        placeholder="smoke, api, core" style={{ fontSize: '0.78rem', width: '100%' }} />
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>Description</label>
                    <input value={subDesc} onChange={e => setSubDesc(e.target.value)}
                      placeholder="Brief description of what this scenario tests" style={{ fontSize: '0.78rem', width: '100%' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 600, display: 'block', marginBottom: '0.2rem' }}>Your Name</label>
                    <input value={subRequester} onChange={e => setSubRequester(e.target.value)}
                      placeholder="anonymous" style={{ fontSize: '0.78rem', width: '100%' }} />
                  </div>
                </div>

                <div style={{ marginBottom: '0.5rem' }}>
                  <label style={{ fontSize: '0.72rem', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                    Exchanges ({subSteps.length})
                  </label>
                  {subSteps.map((step, i) => (
                    <div key={i} style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.35rem', alignItems: 'flex-start' }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.5rem', minWidth: 20, textAlign: 'right' }}>
                        {i + 1}.
                      </span>
                      <input value={step.name} onChange={e => updateStep(i, 'name', e.target.value)}
                        placeholder="Step name" style={{ fontSize: '0.75rem', width: 120 }} />
                      <input value={step.message} onChange={e => updateStep(i, 'message', e.target.value)}
                        placeholder="Message to send [optional notes in brackets]" style={{ fontSize: '0.75rem', flex: 1 }} />
                      {subSteps.length > 1 && (
                        <button type="button" onClick={() => removeStep(i)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.35rem', color: 'var(--text-muted)' }}>
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={addStep}
                    style={{ fontSize: '0.7rem', padding: '0.2em 0.5em', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                    <Plus size={11} /> Add Exchange
                  </button>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <button type="button" onClick={handleSubmitScenario} className="primary" disabled={submitting || !subName.trim() || !subDesc.trim()}
                    style={{ fontSize: '0.75rem', padding: '0.4em 1em' }}>
                    {submitting ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Submitting...</>
                      : submitted ? <><CheckCircle size={12} /> Submitted!</>
                      : <><Send size={12} /> Submit for Review</>}
                  </button>
                  <button type="button" onClick={() => setShowSubmit(false)}
                    style={{ fontSize: '0.72rem', padding: '0.4em 0.8em' }}>Cancel</button>
                  {submitted && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--green)' }}>
                      Submitted! An admin will review your scenario.
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>Ring Settings</h3>
            {admin && (
              <button type="button" onClick={handleSaveDefaults} disabled={saving}
                style={{ fontSize: '0.72rem', padding: '0.3em 0.7em', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                {saving ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Saving...</>
                  : saved ? <><CheckCircle size={12} style={{ color: 'var(--green)' }} /> Saved</>
                  : <><Save size={12} /> Save as Default</>}
              </button>
            )}
          </div>
          <div className="form-row" style={{ marginTop: '0.75rem' }}>
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
