import { useState, useEffect } from 'react'
import { ShieldCheck, ExternalLink, RefreshCw, BarChart3, CheckCircle, XCircle, AlertCircle, Globe, Grid3x3 } from 'lucide-react'
import { getCoverageSummary, getRequirementCoverage, getMcpToolCoverage, getEnvComparison, getTrending, getActualToolCoverage } from '../api'

function Badge({ color, children }) {
  return (
    <span style={{
      fontSize: '0.65rem', padding: '0.12em 0.5em', borderRadius: '10px',
      background: `${color}18`, color, fontWeight: 500,
    }}>{children}</span>
  )
}

function ProgressBar({ pct, color = 'var(--accent)' }) {
  return (
    <div style={{ width: '100%', height: 8, background: 'var(--bg-primary)', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.3s' }} />
    </div>
  )
}

export default function CoverageDashboard() {
  const [summary, setSummary] = useState(null)
  const [reqCoverage, setReqCoverage] = useState(null)
  const [toolCoverage, setToolCoverage] = useState(null)
  const [envComparison, setEnvComparison] = useState(null)
  const [trending, setTrending] = useState(null)
  const [actualTools, setActualTools] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('requirements')
  const [refreshing, setRefreshing] = useState(false)

  const load = async () => {
    try {
      const [sumData, envData, trendData] = await Promise.all([
        getCoverageSummary(), getEnvComparison(), getTrending(),
      ])
      setSummary(sumData)
      setEnvComparison(envData.environments || [])
      setTrending(trendData)
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const loadTab = async (tab) => {
    setActiveTab(tab)
    if (tab === 'requirements' && !reqCoverage) {
      try { setReqCoverage(await getRequirementCoverage()) } catch { /* ignore */ }
    }
    if (tab === 'tools' && !toolCoverage) {
      try {
        const [declared, actual] = await Promise.all([getMcpToolCoverage(), getActualToolCoverage()])
        setToolCoverage(declared)
        setActualTools(actual)
      } catch { /* ignore */ }
    }
    if (tab === 'traceability' && !reqCoverage) {
      try { setReqCoverage(await getRequirementCoverage()) } catch { /* ignore */ }
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    setReqCoverage(null)
    setToolCoverage(null)
    setActualTools(null)
    await load()
    await loadTab(activeTab)
    setRefreshing(false)
  }

  useEffect(() => { loadTab(activeTab) }, [])

  if (loading) return <div className="empty"><span className="spinner" /> Loading coverage data...</div>

  const reqPct = summary?.requirement_coverage_pct || 0
  const toolPct = summary?.tool_coverage_pct || 0

  return (
    <div>
      <div className="page-header">
        <h2><ShieldCheck size={20} /> Coverage</h2>
        <button onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Refreshing...</> : <><RefreshCw size={14} /> Refresh</>}
        </button>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
        <SummaryCard label="Requirement Coverage" value={`${reqPct}%`} color={reqPct > 70 ? 'var(--green)' : reqPct > 40 ? 'var(--yellow)' : 'var(--red)'} sub={`${summary?.requirement_total || 0} requirements`} />
        <SummaryCard label="MCP Tool Coverage" value={`${toolPct}%`} color={toolPct > 70 ? 'var(--green)' : toolPct > 40 ? 'var(--yellow)' : 'var(--red)'} sub={`${summary?.tool_total || 0} tools`} />
        <SummaryCard label="Total Test Cases" value={summary?.total_cases || 0} color="var(--accent)" sub={`${summary?.approved_cases || 0} approved`} />
        <SummaryCard label="Avg Score" value={summary?.avg_score != null ? summary.avg_score.toFixed(1) : '-'} color="var(--blue)" sub="across all runs" />
      </div>

      {/* Tab navigation */}
      <div style={{ display: 'flex', gap: 0, marginBottom: '1rem', borderBottom: '2px solid var(--border)' }}>
        {[
          { key: 'requirements', label: 'Requirements' },
          { key: 'tools', label: 'MCP Tools' },
          { key: 'traceability', label: 'Traceability' },
          { key: 'comparison', label: 'Env Comparison' },
          { key: 'trends', label: 'Trends' },
        ].map(tab => (
          <button key={tab.key} onClick={() => loadTab(tab.key)} style={{
            fontSize: '0.78rem', padding: '0.5em 1em', border: 'none', cursor: 'pointer',
            background: activeTab === tab.key ? 'var(--bg-card)' : 'transparent',
            color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
            marginBottom: -2, fontWeight: activeTab === tab.key ? 600 : 400,
          }}>{tab.label}</button>
        ))}
      </div>

      {/* Requirements Coverage Tab */}
      {activeTab === 'requirements' && (
        <div className="card">
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>Requirement Coverage Matrix</h3>
          {!reqCoverage ? (
            <div className="empty"><span className="spinner" /> Loading...</div>
          ) : reqCoverage.items?.length === 0 ? (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '1rem 0' }}>
              No requirements found. Add data sources and sync them first.
            </div>
          ) : (
            <>
              <div style={{ marginBottom: '0.5rem' }}>
                <ProgressBar pct={reqCoverage.coverage_pct} color={reqCoverage.coverage_pct > 70 ? 'var(--green)' : 'var(--yellow)'} />
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  {reqCoverage.covered} of {reqCoverage.total} requirements covered ({reqCoverage.coverage_pct}%)
                </div>
              </div>
              <table style={{ width: '100%', fontSize: '0.73rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
                    <th style={{ textAlign: 'left', padding: '0.35rem 0.5rem', fontWeight: 600 }}>Requirement</th>
                    <th style={{ textAlign: 'center', padding: '0.35rem 0.5rem', fontWeight: 600, width: 60 }}>Type</th>
                    <th style={{ textAlign: 'center', padding: '0.35rem 0.5rem', fontWeight: 600, width: 70 }}>Status</th>
                    <th style={{ textAlign: 'left', padding: '0.35rem 0.5rem', fontWeight: 600 }}>Test Cases</th>
                  </tr>
                </thead>
                <tbody>
                  {reqCoverage.items.map(item => (
                    <tr key={item.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.3rem 0.5rem' }}>
                        {item.external_url ? (
                          <a href={item.external_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                            {item.title} <ExternalLink size={9} style={{ verticalAlign: 'middle' }} />
                          </a>
                        ) : item.title}
                      </td>
                      <td style={{ textAlign: 'center', padding: '0.3rem 0.5rem' }}>
                        <Badge color="var(--text-muted)">{item.item_type}</Badge>
                      </td>
                      <td style={{ textAlign: 'center', padding: '0.3rem 0.5rem' }}>
                        {item.covered
                          ? <CheckCircle size={14} style={{ color: 'var(--green)' }} />
                          : <XCircle size={14} style={{ color: 'var(--red)' }} />
                        }
                      </td>
                      <td style={{ padding: '0.3rem 0.5rem', fontSize: '0.68rem' }}>
                        {item.test_cases.length === 0
                          ? <span style={{ color: 'var(--text-muted)' }}>Not covered</span>
                          : item.test_cases.map(tc => (
                              <span key={tc.id} style={{ marginRight: '0.3rem' }}>
                                <Badge color={tc.status === 'approved' ? 'var(--green)' : 'var(--blue)'}>{tc.name}</Badge>
                              </span>
                            ))
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {/* MCP Tools Coverage Tab */}
      {activeTab === 'tools' && (
        <div className="card">
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>MCP Tool Coverage Matrix</h3>
          {!toolCoverage ? (
            <div className="empty"><span className="spinner" /> Loading...</div>
          ) : toolCoverage.tools?.length === 0 ? (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '1rem 0' }}>
              No MCP tools defined. Add an MCP Tools data source in Arena Settings.
            </div>
          ) : (
            <>
              <div style={{ marginBottom: '0.5rem' }}>
                <ProgressBar pct={toolCoverage.coverage_pct} color={toolCoverage.coverage_pct > 70 ? 'var(--green)' : 'var(--yellow)'} />
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                  {toolCoverage.covered} of {toolCoverage.total} tools covered ({toolCoverage.coverage_pct}%)
                  {Array.isArray(actualTools?.tools) && <> — <strong>{actualTools.tools.filter(t => t.call_count > 0).length}</strong> actually called in execution</>}
                </div>
              </div>
              <table style={{ width: '100%', fontSize: '0.73rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
                    <th style={{ textAlign: 'left', padding: '0.35rem 0.5rem', fontWeight: 600 }}>Tool</th>
                    <th style={{ textAlign: 'center', padding: '0.35rem 0.5rem', fontWeight: 600, width: 65 }}>Declared</th>
                    <th style={{ textAlign: 'center', padding: '0.35rem 0.5rem', fontWeight: 600, width: 65 }}>Actual</th>
                    <th style={{ textAlign: 'left', padding: '0.35rem 0.5rem', fontWeight: 600 }}>Test Cases</th>
                  </tr>
                </thead>
                <tbody>
                  {toolCoverage.tools.map((tool, idx) => {
                    const actual = Array.isArray(actualTools?.tools) ? actualTools.tools.find(t => t.tool_name === tool.name) : null
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.3rem 0.5rem' }}>
                          <div style={{ fontWeight: 500 }}>{tool.name}</div>
                          {tool.description && <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{tool.description.slice(0, 100)}</div>}
                        </td>
                        <td style={{ textAlign: 'center', padding: '0.3rem 0.5rem' }}>
                          {tool.covered
                            ? <CheckCircle size={14} style={{ color: 'var(--green)' }} />
                            : <XCircle size={14} style={{ color: 'var(--red)' }} />
                          }
                        </td>
                        <td style={{ textAlign: 'center', padding: '0.3rem 0.5rem' }}>
                          {actual && actual.call_count > 0
                            ? <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--green)' }} title={`${actual.call_count} calls across ${actual.session_count} sessions`}>{actual.call_count}x</span>
                            : <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>0</span>
                          }
                        </td>
                        <td style={{ padding: '0.3rem 0.5rem', fontSize: '0.68rem' }}>
                          {tool.test_cases.length === 0
                            ? <span style={{ color: 'var(--text-muted)' }}>Not tested</span>
                            : tool.test_cases.map(tc => (
                                <span key={tc.id} style={{ marginRight: '0.3rem' }}>
                                  <Badge color={tc.status === 'approved' ? 'var(--green)' : 'var(--blue)'}>{tc.name}</Badge>
                                </span>
                              ))
                          }
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {/* Traceability Matrix Tab */}
      {activeTab === 'traceability' && (
        <div className="card">
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>
            <Grid3x3 size={14} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
            Traceability Matrix
          </h3>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
            Requirements mapped to test cases. Green = covered with passing score, Yellow = covered but needs attention, Red = failing, Gray = not covered.
          </p>
          {!reqCoverage ? (
            <div className="empty"><span className="spinner" /> Loading...</div>
          ) : reqCoverage.items?.length === 0 ? (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '1rem 0' }}>
              No requirements found. Sync data sources first.
            </div>
          ) : (() => {
            // Collect all unique test cases across requirements
            const allTestCases = []
            const tcIds = new Set()
            reqCoverage.items.forEach(item => {
              item.test_cases.forEach(tc => {
                if (!tcIds.has(tc.id)) { tcIds.add(tc.id); allTestCases.push(tc) }
              })
            })
            return allTestCases.length === 0 ? (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '1rem 0' }}>
                No test cases linked to requirements yet. Generate test cases from data sources.
              </div>
            ) : (
              <div style={{ overflow: 'auto', maxHeight: 500 }}>
                <table style={{ fontSize: '0.65rem', borderCollapse: 'collapse', whiteSpace: 'nowrap' }}>
                  <thead>
                    <tr style={{ position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1 }}>
                      <th style={{ padding: '0.3rem 0.5rem', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid var(--border)', minWidth: 160, position: 'sticky', left: 0, background: 'var(--bg-card)' }}>Requirement</th>
                      {allTestCases.map(tc => (
                        <th key={tc.id} style={{ padding: '0.3rem 0.3rem', fontWeight: 500, borderBottom: '1px solid var(--border)', textAlign: 'center', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis' }} title={tc.name}>
                          <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', maxHeight: 80, overflow: 'hidden', textOverflow: 'ellipsis' }}>{tc.name}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reqCoverage.items.map(item => (
                      <tr key={item.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.25rem 0.5rem', fontWeight: 500, position: 'sticky', left: 0, background: 'var(--bg-card)', borderRight: '1px solid var(--border)' }}>
                          {item.external_url ? (
                            <a href={item.external_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                              {item.title.slice(0, 30)}{item.title.length > 30 ? '...' : ''} <ExternalLink size={8} />
                            </a>
                          ) : <span title={item.title}>{item.title.slice(0, 30)}{item.title.length > 30 ? '...' : ''}</span>}
                        </td>
                        {allTestCases.map(tc => {
                          const linked = item.test_cases.find(t => t.id === tc.id)
                          let bg = '#f3f4f6' // gray - not linked
                          let label = ''
                          if (linked) {
                            if (linked.last_run_score >= 4) { bg = '#dcfce7'; label = linked.last_run_score.toFixed(1) }
                            else if (linked.last_run_score >= 3) { bg = '#fef9c3'; label = linked.last_run_score.toFixed(1) }
                            else if (linked.last_run_score != null) { bg = '#fee2e2'; label = linked.last_run_score.toFixed(1) }
                            else { bg = '#e0e7ff'; label = '?' }
                          }
                          return (
                            <td key={tc.id} style={{ textAlign: 'center', padding: '0.2rem', background: bg, border: '1px solid var(--bg-card)' }}
                              title={linked ? `${tc.name}: ${label}` : 'Not linked'}>
                              <span style={{ fontSize: '0.58rem', fontWeight: linked ? 600 : 400, color: linked ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                                {label}
                              </span>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })()}
        </div>
      )}

      {/* Environment Comparison Tab */}
      {activeTab === 'comparison' && (
        <div className="card">
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>
            <Globe size={14} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
            Environment Comparison
          </h3>
          {!envComparison || envComparison.length === 0 ? (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '1rem 0' }}>
              No environments with data sources found.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(envComparison.length, 4)}, 1fr)`, gap: '0.75rem' }}>
              {envComparison.map(env => (
                <div key={env.env_key} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.75rem' }}>
                  <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', textTransform: 'capitalize' }}>{env.env_key}</h4>
                  <div style={{ fontSize: '0.72rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Req Coverage</span>
                      <strong style={{ color: env.requirement_coverage_pct > 70 ? 'var(--green)' : 'var(--yellow)' }}>{env.requirement_coverage_pct}%</strong>
                    </div>
                    <ProgressBar pct={env.requirement_coverage_pct} color={env.requirement_coverage_pct > 70 ? 'var(--green)' : 'var(--yellow)'} />
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Tool Coverage</span>
                      <strong style={{ color: env.tool_coverage_pct > 70 ? 'var(--green)' : 'var(--yellow)' }}>{env.tool_coverage_pct}%</strong>
                    </div>
                    <ProgressBar pct={env.tool_coverage_pct} color={env.tool_coverage_pct > 70 ? 'var(--green)' : 'var(--yellow)'} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.2rem' }}>
                      <span>Test Cases</span>
                      <strong>{env.total_cases} ({env.approved_cases} approved)</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Avg Score</span>
                      <strong>{env.avg_score != null ? env.avg_score.toFixed(1) : '-'}</strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Trends Tab */}
      {activeTab === 'trends' && (
        <div className="card">
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>
            <BarChart3 size={14} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
            Trends (Last 30 Days)
          </h3>
          {!trending ? (
            <div className="empty"><span className="spinner" /> Loading...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Case count timeline */}
              <div>
                <h4 style={{ fontSize: '0.78rem', margin: '0 0 0.3rem' }}>Test Cases Created</h4>
                {trending.case_counts?.length === 0 ? (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>No data yet</div>
                ) : (
                  <div style={{ display: 'flex', gap: '0.2rem', alignItems: 'flex-end', height: 80 }}>
                    {trending.case_counts.map((d, idx) => {
                      const max = Math.max(...trending.case_counts.map(c => c.count))
                      const h = max > 0 ? (d.count / max) * 70 + 10 : 10
                      return (
                        <div key={idx} title={`${d.date}: ${d.count} cases`} style={{
                          flex: 1, height: h, background: 'var(--accent)', borderRadius: '3px 3px 0 0',
                          minWidth: 4, maxWidth: 20,
                        }} />
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Score timeline */}
              <div>
                <h4 style={{ fontSize: '0.78rem', margin: '0 0 0.3rem' }}>Avg Score per Day</h4>
                {trending.score_trends?.length === 0 ? (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>No runs yet</div>
                ) : (
                  <div style={{ display: 'flex', gap: '0.2rem', alignItems: 'flex-end', height: 80 }}>
                    {trending.score_trends.map((d, idx) => {
                      const score = d.avg_score || 0
                      const h = (score / 5) * 70 + 10
                      const color = score >= 4 ? 'var(--green)' : score >= 3 ? 'var(--yellow)' : 'var(--red)'
                      return (
                        <div key={idx} title={`${d.date}: ${score.toFixed(1)} avg (${d.runs} runs)`} style={{
                          flex: 1, height: h, background: color, borderRadius: '3px 3px 0 0',
                          minWidth: 4, maxWidth: 20,
                        }} />
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Coverage snapshots */}
              <div>
                <h4 style={{ fontSize: '0.78rem', margin: '0 0 0.3rem' }}>Coverage Over Time</h4>
                {trending.coverage_snapshots?.length === 0 ? (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>No coverage data yet. Run coverage analysis first.</div>
                ) : (
                  <table style={{ width: '100%', fontSize: '0.7rem', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        <th style={{ textAlign: 'left', padding: '0.25rem 0.4rem' }}>Date</th>
                        <th style={{ textAlign: 'left', padding: '0.25rem 0.4rem' }}>Type</th>
                        <th style={{ textAlign: 'right', padding: '0.25rem 0.4rem' }}>Coverage</th>
                        <th style={{ textAlign: 'right', padding: '0.25rem 0.4rem' }}>Items</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trending.coverage_snapshots.slice(-20).map((snap, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '0.2rem 0.4rem' }}>{new Date(snap.created_at + 'Z').toLocaleDateString()}</td>
                          <td style={{ padding: '0.2rem 0.4rem' }}>{snap.snapshot_type}</td>
                          <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right', fontWeight: 600, color: snap.coverage_pct > 70 ? 'var(--green)' : 'var(--yellow)' }}>
                            {snap.coverage_pct}%
                          </td>
                          <td style={{ padding: '0.2rem 0.4rem', textAlign: 'right' }}>{snap.covered_items}/{snap.total_items}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, color, sub }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '0.85rem' }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{sub}</div>}
    </div>
  )
}
