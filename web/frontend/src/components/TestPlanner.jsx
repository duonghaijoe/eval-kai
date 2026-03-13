import { useState, useEffect, useRef } from 'react'
import { Wand2, Play, CheckCircle, XCircle, RefreshCw, ChevronDown, ChevronRight, Eye, Edit3, Trash2, ExternalLink, ArrowUpRight, Filter, Check, X, AlertCircle, Loader } from 'lucide-react'
import { useAdmin } from '../AdminContext'
import { listDataSources, listTestPlans, getTestPlan, deleteTestPlan, generateTestPlan, listTestCases, updateTestCase, approveTestCase, rejectTestCase, regenerateTestCase, promoteTestCase, bulkApproveTestCases, deleteTestCase, bulkDeleteTestCases } from '../api'

const MODE_COLORS = { fixed: 'var(--green)', hybrid: 'var(--orange)' }
const PRIORITY_COLORS = { high: 'var(--red)', medium: 'var(--yellow)', low: 'var(--text-muted)' }
const STATUS_COLORS = { draft: 'var(--blue)', approved: 'var(--green)', rejected: 'var(--red)', archived: 'var(--text-muted)' }

function Badge({ color, children }) {
  return (
    <span style={{
      fontSize: '0.65rem', padding: '0.12em 0.5em', borderRadius: '10px',
      background: `${color}18`, color, fontWeight: 500,
    }}>{children}</span>
  )
}

function ConfirmModal({ title, message, confirmLabel = 'Confirm', confirmColor = 'var(--red)', onConfirm, onCancel, input, onInputChange, inputPlaceholder }) {
  const [inputVal, setInputVal] = useState('')
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }} onClick={onCancel}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius)', padding: '1.5rem', width: 420, boxShadow: '0 8px 30px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>{title}</h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 1rem' }}>{message}</p>
        {input && (
          <div style={{ marginBottom: '0.75rem' }}>
            <input value={inputVal} onChange={e => { setInputVal(e.target.value); onInputChange?.(e.target.value) }} placeholder={inputPlaceholder} style={{ width: '100%', fontSize: '0.78rem' }} autoFocus />
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button onClick={onCancel} style={{ fontSize: '0.78rem' }}>Cancel</button>
          <button onClick={onConfirm} style={{ fontSize: '0.78rem', background: confirmColor, color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '0.4em 1em', cursor: 'pointer' }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TestPlanner() {
  const { admin: isAdmin } = useAdmin()
  const [plans, setPlans] = useState([])
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedPlan, setExpandedPlan] = useState(null)
  const [planCases, setPlanCases] = useState({})
  const [selectedCases, setSelectedCases] = useState(new Set())
  const [editCase, setEditCase] = useState(null)
  const [viewCase, setViewCase] = useState(null)
  const [showGenerate, setShowGenerate] = useState(false)

  // Generate form state
  const [genSourceIds, setGenSourceIds] = useState([])
  const [genModel, setGenModel] = useState('sonnet')
  const [genName, setGenName] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState(null)

  // Confirm modal state
  const [confirmModal, setConfirmModal] = useState(null)
  const regenFeedbackRef = useRef('')

  const load = async () => {
    try {
      const [planData, srcData] = await Promise.all([listTestPlans(), listDataSources()])
      setPlans(planData.plans || [])
      setSources(srcData.sources || [])
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleGenerate = async () => {
    if (genSourceIds.length === 0) { setGenError('Select at least one data source'); return }
    setGenerating(true)
    setGenError(null)
    try {
      const plan = await generateTestPlan({
        source_ids: genSourceIds, model: genModel,
        name: genName || undefined,
      })
      if (plan.status === 'error') {
        setGenError(plan.error || 'Generation failed')
      } else {
        setShowGenerate(false)
        setGenName('')
        setGenSourceIds([])
      }
      await load()
      if (plan.id) setExpandedPlan(plan.id)
    } catch (err) {
      setGenError(err.message)
    }
    setGenerating(false)
  }

  const loadPlanCases = async (planId) => {
    try {
      const data = await getTestPlan(planId)
      setPlanCases(p => ({ ...p, [planId]: data.cases || [] }))
    } catch { /* ignore */ }
  }

  const togglePlan = async (planId) => {
    if (expandedPlan === planId) { setExpandedPlan(null); return }
    setExpandedPlan(planId)
    setSelectedCases(new Set())
    if (!planCases[planId]) await loadPlanCases(planId)
  }

  const handleApprove = async (caseId) => {
    try {
      await approveTestCase(caseId)
      if (expandedPlan) await loadPlanCases(expandedPlan)
      await load()
    } catch { /* ignore */ }
  }

  const handleReject = async (caseId) => {
    try {
      await rejectTestCase(caseId)
      if (expandedPlan) await loadPlanCases(expandedPlan)
      await load()
    } catch { /* ignore */ }
  }

  const handleBulkApprove = async () => {
    if (selectedCases.size === 0) return
    try {
      await bulkApproveTestCases([...selectedCases])
      setSelectedCases(new Set())
      if (expandedPlan) await loadPlanCases(expandedPlan)
      await load()
    } catch { /* ignore */ }
  }

  const handlePromote = async (caseId) => {
    try {
      await promoteTestCase(caseId)
      if (expandedPlan) await loadPlanCases(expandedPlan)
      setConfirmModal({ title: 'Promoted', message: 'Test case promoted to Fixed Scenarios.', confirmLabel: 'OK', confirmColor: 'var(--green)', onConfirm: () => setConfirmModal(null), onCancel: () => setConfirmModal(null), info: true })
    } catch (err) {
      setConfirmModal({ title: 'Error', message: err.message, confirmLabel: 'OK', confirmColor: 'var(--red)', onConfirm: () => setConfirmModal(null), onCancel: () => setConfirmModal(null), info: true })
    }
  }

  const handleRegenerate = async (caseId, feedback) => {
    try {
      await regenerateTestCase(caseId, feedback)
      if (expandedPlan) await loadPlanCases(expandedPlan)
    } catch { /* ignore */ }
  }

  const confirmDeleteCase = (caseId) => {
    setConfirmModal({
      title: 'Discard Test Case',
      message: 'Are you sure you want to discard this test case? This cannot be undone.',
      confirmLabel: 'Discard',
      onConfirm: async () => {
        setConfirmModal(null)
        try {
          await deleteTestCase(caseId)
          setSelectedCases(prev => { const n = new Set(prev); n.delete(caseId); return n })
          if (expandedPlan) await loadPlanCases(expandedPlan)
          await load()
        } catch { /* ignore */ }
      },
      onCancel: () => setConfirmModal(null),
    })
  }

  const confirmDeletePlan = (planId) => {
    setConfirmModal({
      title: 'Discard Test Plan',
      message: 'Are you sure you want to discard this entire test plan and all its cases? This cannot be undone.',
      confirmLabel: 'Discard Plan',
      onConfirm: async () => {
        setConfirmModal(null)
        try {
          await deleteTestPlan(planId)
          if (expandedPlan === planId) setExpandedPlan(null)
          await load()
        } catch { /* ignore */ }
      },
      onCancel: () => setConfirmModal(null),
    })
  }

  const confirmBulkDelete = () => {
    if (selectedCases.size === 0) return
    setConfirmModal({
      title: 'Discard Selected Cases',
      message: `Are you sure you want to discard ${selectedCases.size} selected test case(s)? This cannot be undone.`,
      confirmLabel: `Discard ${selectedCases.size} Cases`,
      onConfirm: async () => {
        setConfirmModal(null)
        try {
          await bulkDeleteTestCases([...selectedCases])
          setSelectedCases(new Set())
          if (expandedPlan) await loadPlanCases(expandedPlan)
          await load()
        } catch { /* ignore */ }
      },
      onCancel: () => setConfirmModal(null),
    })
  }

  const confirmRegenerate = (caseId) => {
    regenFeedbackRef.current = ''
    setConfirmModal({
      title: 'Regenerate Test Case',
      message: 'Provide optional feedback to guide the regeneration.',
      confirmLabel: 'Regenerate',
      confirmColor: 'var(--accent)',
      input: true,
      inputPlaceholder: 'e.g. Make it test edge cases...',
      onInputChange: (v) => { regenFeedbackRef.current = v },
      onConfirm: async () => {
        setConfirmModal(null)
        await handleRegenerate(caseId, regenFeedbackRef.current)
      },
      onCancel: () => setConfirmModal(null),
    })
  }

  const toggleSelectCase = (caseId) => {
    setSelectedCases(prev => {
      const next = new Set(prev)
      if (next.has(caseId)) next.delete(caseId)
      else next.add(caseId)
      return next
    })
  }

  const selectAllDrafts = () => {
    const cases = planCases[expandedPlan] || []
    const drafts = cases.filter(c => c.status === 'draft').map(c => c.id)
    setSelectedCases(new Set(drafts))
  }

  if (loading) return <div className="empty"><span className="spinner" /> Loading test planner...</div>

  return (
    <div>
      <div className="page-header">
        <h2><Wand2 size={20} /> Test Planner</h2>
        {isAdmin && (
          <button className="primary" onClick={() => setShowGenerate(!showGenerate)}>
            <Wand2 size={14} style={{ verticalAlign: 'middle', marginRight: '0.25rem' }} />
            Generate Test Plan
          </button>
        )}
      </div>

      {/* Generate Panel */}
      {showGenerate && (
        <div className="card" style={{ marginBottom: '1rem', borderLeft: '3px solid var(--accent)' }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>Generate New Test Plan</h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>
            Select data sources and let AI generate test cases from your requirements.
          </p>

          <div style={{ marginBottom: '0.6rem' }}>
            <label style={{ fontSize: '0.73rem', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Plan Name (optional)</label>
            <input value={genName} onChange={e => setGenName(e.target.value)} placeholder="e.g. Sprint 1 Regression" style={{ width: '100%', maxWidth: 400 }} />
          </div>

          <div style={{ marginBottom: '0.6rem' }}>
            <label style={{ fontSize: '0.73rem', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Data Sources</label>
            {sources.length === 0 ? (
              <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                No data sources configured. Go to Arena Settings → Data Sources to add some.
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {sources.filter(s => s.enabled).map(src => (
                  <label key={src.id} style={{
                    fontSize: '0.73rem', padding: '0.3em 0.7em', borderRadius: '6px',
                    border: genSourceIds.includes(src.id) ? '2px solid var(--accent)' : '1px solid var(--border)',
                    background: genSourceIds.includes(src.id) ? '#f0f0ff' : 'var(--bg-card)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem',
                  }}>
                    <input type="checkbox" checked={genSourceIds.includes(src.id)}
                      onChange={e => {
                        if (e.target.checked) setGenSourceIds(p => [...p, src.id])
                        else setGenSourceIds(p => p.filter(id => id !== src.id))
                      }}
                    />
                    {src.name} <span style={{ color: 'var(--text-muted)' }}>({src.item_count || 0})</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ fontSize: '0.73rem', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Model</label>
            <select value={genModel} onChange={e => setGenModel(e.target.value)} style={{ fontSize: '0.78rem' }}>
              <option value="sonnet">Sonnet (fast)</option>
              <option value="opus">Opus (thorough)</option>
            </select>
          </div>

          {genError && <div style={{ fontSize: '0.73rem', color: 'var(--red)', marginBottom: '0.5rem' }}><AlertCircle size={12} style={{ verticalAlign: 'middle' }} /> {genError}</div>}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="primary" onClick={handleGenerate} disabled={generating}>
              {generating ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Generating...</> : <><Wand2 size={14} /> Generate</>}
            </button>
            <button onClick={() => setShowGenerate(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Plan History */}
      {plans.length === 0 ? (
        <div className="empty" style={{ padding: '3rem' }}>
          No test plans yet. Generate one from your data sources.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {plans.map(plan => {
            const expanded = expandedPlan === plan.id
            const cases = planCases[plan.id] || []
            const statusColor = plan.status === 'ready' ? 'var(--green)' : plan.status === 'generating' ? 'var(--blue)' : plan.status === 'error' ? 'var(--red)' : 'var(--text-muted)'

            return (
              <div key={plan.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{
                  padding: '0.7rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  cursor: 'pointer', background: expanded ? 'var(--bg-primary)' : 'var(--bg-card)',
                }} onClick={() => togglePlan(plan.id)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{plan.name}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {plan.total_cases} cases ({plan.approved_cases} approved) — {new Date(plan.created_at + 'Z').toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }} onClick={e => e.stopPropagation()}>
                    <Badge color={statusColor}>{plan.status}</Badge>
                    {plan.model && <Badge color="var(--text-muted)">{plan.model}</Badge>}
                    {isAdmin && (
                      <button onClick={() => confirmDeletePlan(plan.id)} title="Discard entire plan" style={{ fontSize: '0.65rem', padding: '0.15em 0.4em', color: 'var(--red)' }}>
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {expanded && (
                  <div style={{ borderTop: '1px solid var(--border)' }}>
                    {plan.error && (
                      <div style={{ padding: '0.5rem 1rem', fontSize: '0.73rem', color: 'var(--red)', background: '#fef2f2' }}>
                        <AlertCircle size={12} style={{ verticalAlign: 'middle' }} /> {plan.error}
                      </div>
                    )}

                    {cases.length === 0 && plan.status === 'generating' && (
                      <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                        <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> Generating test cases...
                      </div>
                    )}

                    {cases.length > 0 && (
                      <>
                        {/* Bulk actions bar */}
                        <div style={{ padding: '0.4rem 1rem', display: 'flex', gap: '0.4rem', alignItems: 'center', borderBottom: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
                          <button onClick={selectAllDrafts} style={{ fontSize: '0.68rem', padding: '0.2em 0.5em' }}>Select All Drafts</button>
                          {selectedCases.size > 0 && (
                            <>
                              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{selectedCases.size} selected</span>
                              <button onClick={handleBulkApprove} className="primary" style={{ fontSize: '0.68rem', padding: '0.2em 0.5em' }}>
                                <Check size={10} /> Approve Selected
                              </button>
                              <button onClick={confirmBulkDelete} style={{ fontSize: '0.68rem', padding: '0.2em 0.5em', color: 'var(--red)' }}>
                                <Trash2 size={10} /> Discard Selected
                              </button>
                              <button onClick={() => setSelectedCases(new Set())} style={{ fontSize: '0.68rem', padding: '0.2em 0.5em' }}>Clear</button>
                            </>
                          )}
                        </div>

                        {/* Cases table */}
                        <table style={{ width: '100%', fontSize: '0.73rem', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
                              <th style={{ width: 30, padding: '0.35rem 0.5rem' }}></th>
                              <th style={{ textAlign: 'left', padding: '0.35rem 0.5rem', fontWeight: 600 }}>Name</th>
                              <th style={{ textAlign: 'center', padding: '0.35rem 0.5rem', fontWeight: 600, width: 60 }}>Mode</th>
                              <th style={{ textAlign: 'center', padding: '0.35rem 0.5rem', fontWeight: 600, width: 60 }}>Priority</th>
                              <th style={{ textAlign: 'center', padding: '0.35rem 0.5rem', fontWeight: 600, width: 70 }}>Status</th>
                              <th style={{ textAlign: 'center', padding: '0.35rem 0.5rem', fontWeight: 600, width: 70 }}>Score</th>
                              <th style={{ textAlign: 'right', padding: '0.35rem 0.5rem', fontWeight: 600, width: 120 }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cases.map(tc => (
                              <tr key={tc.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '0.3rem 0.5rem', textAlign: 'center' }}>
                                  <input type="checkbox" checked={selectedCases.has(tc.id)} onChange={() => toggleSelectCase(tc.id)} />
                                </td>
                                <td style={{ padding: '0.3rem 0.5rem' }}>
                                  <div style={{ fontWeight: 500, cursor: 'pointer', color: 'var(--accent)' }} onClick={() => setViewCase(tc)} title="View details">
                                    {tc.name}
                                    {tc.tags?.includes('promoted') && (
                                      <span style={{ marginLeft: '0.4rem', fontSize: '0.6rem', padding: '0.1em 0.4em', borderRadius: '8px', background: '#e0e7ff', color: 'var(--accent)', fontWeight: 600, verticalAlign: 'middle' }}>Promoted</span>
                                    )}
                                  </div>
                                  {tc.description && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>{tc.description.slice(0, 100)}</div>}
                                  {tc.source_items?.length > 0 && (
                                    <div style={{ fontSize: '0.63rem', color: 'var(--accent)', marginTop: '0.1rem' }}>
                                      {tc.source_items.map(si => si.external_id || si.title).join(', ')}
                                    </div>
                                  )}
                                </td>
                                <td style={{ textAlign: 'center', padding: '0.3rem 0.5rem' }}>
                                  <Badge color={MODE_COLORS[tc.mode] || 'var(--text-muted)'}>{tc.mode}</Badge>
                                </td>
                                <td style={{ textAlign: 'center', padding: '0.3rem 0.5rem' }}>
                                  <Badge color={PRIORITY_COLORS[tc.priority] || 'var(--text-muted)'}>{tc.priority}</Badge>
                                </td>
                                <td style={{ textAlign: 'center', padding: '0.3rem 0.5rem' }}>
                                  <Badge color={STATUS_COLORS[tc.status] || 'var(--text-muted)'}>{tc.status}</Badge>
                                </td>
                                <td style={{ textAlign: 'center', padding: '0.3rem 0.5rem', fontSize: '0.72rem' }}>
                                  {tc.last_run_score != null ? `${tc.last_run_score.toFixed(1)}` : '-'}
                                  {tc.run_count > 0 && <div style={{ fontSize: '0.63rem', color: 'var(--text-muted)' }}>{tc.run_count} runs</div>}
                                </td>
                                <td style={{ textAlign: 'right', padding: '0.3rem 0.5rem' }}>
                                  <div style={{ display: 'flex', gap: '0.2rem', justifyContent: 'flex-end' }}>
                                    {tc.status === 'draft' && isAdmin && (
                                      <>
                                        <button onClick={() => handleApprove(tc.id)} title="Approve" style={{ fontSize: '0.65rem', padding: '0.15em 0.35em', color: 'var(--green)' }}>
                                          <Check size={11} />
                                        </button>
                                        <button onClick={() => handleReject(tc.id)} title="Reject" style={{ fontSize: '0.65rem', padding: '0.15em 0.35em', color: 'var(--red)' }}>
                                          <X size={11} />
                                        </button>
                                      </>
                                    )}
                                    {isAdmin && (
                                      <button onClick={() => setEditCase(tc)} title="Edit" style={{ fontSize: '0.65rem', padding: '0.15em 0.35em' }}>
                                        <Edit3 size={11} />
                                      </button>
                                    )}
                                    {tc.status === 'approved' && !tc.tags?.includes('promoted') && isAdmin && (
                                      <button onClick={() => handlePromote(tc.id)} title="Promote to Scenario" style={{ fontSize: '0.65rem', padding: '0.15em 0.35em', color: 'var(--accent)' }}>
                                        <ArrowUpRight size={11} />
                                      </button>
                                    )}
                                    {isAdmin && (
                                      <button onClick={() => confirmRegenerate(tc.id)} title="Regenerate" style={{ fontSize: '0.65rem', padding: '0.15em 0.35em' }}>
                                        <RefreshCw size={11} />
                                      </button>
                                    )}
                                    {isAdmin && (
                                      <button onClick={() => confirmDeleteCase(tc.id)} title="Discard" style={{ fontSize: '0.65rem', padding: '0.15em 0.35em', color: 'var(--red)' }}>
                                        <Trash2 size={11} />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* View Case Detail Modal */}
      {viewCase && (
        <CaseDetailModal
          testCase={viewCase}
          onClose={() => setViewCase(null)}
          onEdit={(tc) => { setViewCase(null); setEditCase(tc) }}
          isAdmin={isAdmin}
        />
      )}

      {/* Edit Case Modal */}
      {editCase && (
        <CaseEditorModal
          testCase={editCase}
          onClose={() => setEditCase(null)}
          onSaved={async () => {
            setEditCase(null)
            if (expandedPlan) await loadPlanCases(expandedPlan)
          }}
        />
      )}

      {/* Confirm Modal */}
      {confirmModal && (
        <ConfirmModal {...confirmModal} />
      )}
    </div>
  )
}

function CaseDetailModal({ testCase: tc, onClose, onEdit, isAdmin }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius)', padding: '1.5rem', width: 620, maxHeight: '85vh', overflow: 'auto', boxShadow: '0 8px 30px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '0.95rem' }}>
              {tc.name}
              {tc.tags?.includes('promoted') && (
                <Badge color="var(--accent)">Promoted</Badge>
              )}
            </h3>
            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.35rem' }}>
              <Badge color={MODE_COLORS[tc.mode] || 'var(--text-muted)'}>{tc.mode}</Badge>
              <Badge color={PRIORITY_COLORS[tc.priority] || 'var(--text-muted)'}>{tc.priority}</Badge>
              <Badge color={STATUS_COLORS[tc.status] || 'var(--text-muted)'}>{tc.status}</Badge>
              {tc.category && <Badge color="var(--text-muted)">{tc.category}</Badge>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem', color: 'var(--text-muted)' }}>
            <X size={16} />
          </button>
        </div>

        {tc.description && (
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Description</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{tc.description}</div>
          </div>
        )}

        {tc.mode === 'hybrid' && tc.goal && (
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Goal</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5, background: 'var(--bg-primary)', padding: '0.5rem 0.7rem', borderRadius: '6px' }}>{tc.goal}</div>
          </div>
        )}

        {tc.steps?.length > 0 && (
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Rounds ({tc.steps.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {tc.steps.map((step, i) => (
                <div key={i} style={{ fontSize: '0.75rem', padding: '0.4rem 0.6rem', background: 'var(--bg-primary)', borderRadius: '6px', borderLeft: '3px solid var(--accent)' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{step.name || `Step ${i + 1}`}</span>
                  <div style={{ color: 'var(--text-secondary)', marginTop: '0.15rem' }}>{step.message}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tc.mcp_tools_tested?.length > 0 && (
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>MCP Tools Tested</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
              {tc.mcp_tools_tested.map((tool, i) => (
                <span key={i} style={{ fontSize: '0.68rem', padding: '0.15em 0.5em', borderRadius: '8px', background: '#e0e7ff', color: 'var(--accent)', fontWeight: 500 }}>{tool}</span>
              ))}
            </div>
          </div>
        )}

        {tc.source_items?.length > 0 && (
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Source Requirements</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
              {tc.source_items.map((si, i) => (
                <span key={i} style={{ fontSize: '0.68rem', padding: '0.15em 0.5em', borderRadius: '8px', background: 'var(--bg-primary)', color: 'var(--text-secondary)', fontWeight: 500 }}>
                  {si.external_id && <span style={{ color: 'var(--accent)', marginRight: '0.3em' }}>{si.external_id}</span>}
                  {si.title}
                </span>
              ))}
            </div>
          </div>
        )}

        {tc.tags?.length > 0 && (
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Tags</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
              {tc.tags.filter(t => t !== 'promoted').map((tag, i) => (
                <span key={i} style={{ fontSize: '0.65rem', padding: '0.1em 0.45em', borderRadius: '8px', background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>{tag}</span>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.75rem', borderTop: '1px solid var(--border)', paddingTop: '0.6rem' }}>
          <span>Max turns: <strong>{tc.max_turns}</strong></span>
          {tc.last_run_score != null && <span>Last score: <strong>{tc.last_run_score.toFixed(1)}</strong></span>}
          {tc.run_count > 0 && <span>Runs: <strong>{tc.run_count}</strong></span>}
          {tc.last_run_at && <span>Last run: {new Date(tc.last_run_at + 'Z').toLocaleDateString()}</span>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          {isAdmin && <button onClick={() => onEdit(tc)} style={{ fontSize: '0.78rem' }}><Edit3 size={12} style={{ verticalAlign: 'middle', marginRight: '0.2rem' }} />Edit</button>}
          <button onClick={onClose} style={{ fontSize: '0.78rem' }}>Close</button>
        </div>
      </div>
    </div>
  )
}

function CaseEditorModal({ testCase, onClose, onSaved }) {
  const [name, setName] = useState(testCase.name)
  const [description, setDescription] = useState(testCase.description || '')
  const [mode, setMode] = useState(testCase.mode)
  const [priority, setPriority] = useState(testCase.priority)
  const [category, setCategory] = useState(testCase.category)
  const [goal, setGoal] = useState(testCase.goal || '')
  const [maxTurns, setMaxTurns] = useState(testCase.max_turns)
  const [steps, setSteps] = useState(testCase.steps || [])
  const [tags, setTags] = useState((testCase.tags || []).join(', '))
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateTestCase(testCase.id, {
        name, description, mode, priority, category, goal,
        max_turns: maxTurns,
        steps, tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      })
      onSaved()
    } catch { /* ignore */ }
    setSaving(false)
  }

  const updateStep = (idx, field, val) => {
    setSteps(s => s.map((st, i) => i === idx ? { ...st, [field]: val } : st))
  }

  const addStep = () => setSteps(s => [...s, { name: `Step ${s.length + 1}`, message: '' }])
  const removeStep = (idx) => setSteps(s => s.filter((_, i) => i !== idx))

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius)', padding: '1.5rem', width: 600, maxHeight: '85vh', overflow: 'auto', boxShadow: '0 8px 30px rgba(0,0,0,0.15)' }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 1rem' }}>Edit Test Case</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <div>
            <label style={{ fontSize: '0.73rem', fontWeight: 600 }}>Name</label>
            <input value={name} onChange={e => setName(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            <label style={{ fontSize: '0.73rem', fontWeight: 600 }}>Category</label>
            <input value={category} onChange={e => setCategory(e.target.value)} style={{ width: '100%' }} />
          </div>
        </div>

        <div style={{ marginBottom: '0.5rem' }}>
          <label style={{ fontSize: '0.73rem', fontWeight: 600 }}>Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} style={{ width: '100%' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <div>
            <label style={{ fontSize: '0.73rem', fontWeight: 600 }}>Mode</label>
            <select value={mode} onChange={e => setMode(e.target.value)} style={{ width: '100%' }}>
              <option value="fixed">Fixed</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.73rem', fontWeight: 600 }}>Priority</label>
            <select value={priority} onChange={e => setPriority(e.target.value)} style={{ width: '100%' }}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.73rem', fontWeight: 600 }}>Max Turns</label>
            <input type="number" min={1} max={50} value={maxTurns} onChange={e => setMaxTurns(+e.target.value)} style={{ width: '100%' }} />
          </div>
        </div>

        {mode === 'hybrid' && (
          <div style={{ marginBottom: '0.5rem' }}>
            <label style={{ fontSize: '0.73rem', fontWeight: 600 }}>Goal</label>
            <textarea value={goal} onChange={e => setGoal(e.target.value)} rows={2} style={{ width: '100%' }} placeholder="What should the conversation achieve?" />
          </div>
        )}

        {mode === 'fixed' && (
          <div style={{ marginBottom: '0.5rem' }}>
            <label style={{ fontSize: '0.73rem', fontWeight: 600 }}>Steps</label>
            {steps.map((step, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '0.3rem', marginBottom: '0.3rem', alignItems: 'flex-start' }}>
                <input value={step.name} onChange={e => updateStep(idx, 'name', e.target.value)} placeholder="Step name" style={{ width: 120, fontSize: '0.73rem' }} />
                <input value={step.message} onChange={e => updateStep(idx, 'message', e.target.value)} placeholder="User message" style={{ flex: 1, fontSize: '0.73rem' }} />
                <button onClick={() => removeStep(idx)} style={{ fontSize: '0.65rem', padding: '0.2em 0.35em', color: 'var(--red)' }}><Trash2 size={10} /></button>
              </div>
            ))}
            <button onClick={addStep} style={{ fontSize: '0.68rem' }}>+ Add Step</button>
          </div>
        )}

        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ fontSize: '0.73rem', fontWeight: 600 }}>Tags (comma-separated)</label>
          <input value={tags} onChange={e => setTags(e.target.value)} style={{ width: '100%' }} placeholder="auth, login, regression" />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
