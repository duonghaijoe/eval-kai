import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { BookOpen, Swords, Bot, Film, Trophy, Flame, Bell, Building2, Users, Zap, ClipboardList, Compass, Shuffle, Feather, PersonStanding, Dumbbell, Target, Timer, Star, Medal, BarChart3, Wrench, Circle, MessageSquare, Hand } from 'lucide-react'

export default function Guideline() {
  const { hash } = useLocation()

  useEffect(() => {
    if (hash) {
      const el = document.querySelector(hash)
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
    }
  }, [hash])

  return (
    <div className="page">
      <div className="page-header">
        <h2><BookOpen size={20} /> The Fight Manual</h2>
      </div>

      {/* Hero */}
      <div className="card" style={{ padding: '2rem', textAlign: 'center', marginBottom: '1.25rem', background: 'linear-gradient(135deg, var(--katalon-navy) 0%, #2a3f5f 100%)', color: '#fff', borderRadius: 'var(--radius)' }}>
        <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
          <Swords size={36} /> <span style={{ fontSize: '2.5rem', fontWeight: 700 }}>Joe vs Kai</span> <Bot size={36} />
        </div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>The AI Agent Test Arena</h1>
        <p style={{ fontSize: '0.85rem', opacity: 0.8, maxWidth: '600px', margin: '0 auto', lineHeight: 1.6 }}>
          Where we put Katalon's Kai AI agent in the ring, throw every possible punch at it,
          and see if it can take a hit without hallucinating, freezing up, or forgetting what we just said 3 seconds ago.
        </p>
        <p style={{ fontSize: '0.72rem', opacity: 0.5, marginTop: '0.75rem' }}>
          No AIs were harmed in the making of this arena. Except Kai. Repeatedly.
        </p>
      </div>

      {/* What is this */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Film size={16} /> What is this tool?
        </h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '0.75rem' }}>
          <strong>Joe vs Kai</strong> is an AI-powered testing framework that pits a human orchestrator (that's Joe, our test director)
          against Katalon's Kai AI agent. Think of it as a boxing gym where we train, spar, and evaluate Kai
          across every dimension that matters: speed, accuracy, helpfulness, and the ability to not completely
          lose its mind when 20 users ask it questions at the same time.
        </p>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          We use <strong>Claude Code</strong> as the AI test actor — it drives multi-round conversations with Kai,
          decides what to say next based on Kai's responses, and then ruthlessly evaluates the results using
          industry-standard benchmarks. It's like having a boxing judge who also happens to be an AI researcher
          with opinions about latency percentiles.
        </p>
      </div>

      {/* Boxing Terminology */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <BookOpen size={16} /> The Boxing Dictionary
        </h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          We use boxing terminology because "test session with multiple conversation turns" is boring
          and nobody remembers it. Also, everything is more fun when you pretend AI testing is a contact sport.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          {/* Single User */}
          <div style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius)', padding: '1rem' }}>
            <h4 style={{ fontSize: '0.85rem', marginBottom: '0.75rem', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Trophy size={15} /> Single-User Testing (The 1v1)
            </h4>
            <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
              <tbody>
                {[
                  [<Swords size={13} />, 'Match', 'One complete test conversation with Kai (1+ rounds)', 'A fire/explore/hybrid test run. Like a full boxing match — multiple rounds, one outcome.'],
                  [<Bell size={13} />, 'Round', 'A segment within a match (1+ exchanges)', 'A themed block of conversation. Could be "test the login flow" or "push Kai\'s limits on edge cases."'],
                  [<MessageSquare size={13} />, 'Exchange', 'One pair of turns — you talk, Kai talks back', '"Show me test results" → Kai responds. That\'s 1 exchange. Quick jab, see what happens.'],
                ].map(([icon, term, def_, joke], i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.5rem', fontWeight: 600, verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>{icon} {term}</span>
                    </td>
                    <td style={{ padding: '0.5rem', verticalAlign: 'top' }}>
                      <div>{def_}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '0.2rem' }}>{joke}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: '0.5rem', padding: '0.4rem 0.6rem', background: 'var(--bg-hover)', borderRadius: '4px', fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              Match &gt; Round &gt; Exchange (user msg + Kai response)
            </div>
          </div>

          {/* Load Test */}
          <div style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius)', padding: '1rem' }}>
            <h4 style={{ fontSize: '0.85rem', marginBottom: '0.75rem', color: 'var(--red)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Flame size={15} /> Load Testing (The Superfight)
            </h4>
            <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
              <tbody>
                {[
                  [<Building2 size={13} />, 'Superfight', 'The entire load test event', 'The main event. Multiple fighters enter, data comes out.'],
                  [<Users size={13} />, 'Fighter', 'A provisioned test user', 'Each fighter has their own account, auth token, and bad attitude.'],
                  [<Zap size={13} />, 'xPower', 'Concurrent chat windows per fighter', 'Like fighting with both fists. 2 xPower = 2 simultaneous conversations per fighter.'],
                  [<Swords size={13} />, 'Bout', 'One conversation = one Match (fighter x window)', '1 fighter with 1 window = 1 bout. It\'s a Match, but in the arena context.'],
                  [<Bell size={13} />, 'Round', 'A segment within a bout (1+ punches)', 'Same as a Match round — a themed block of exchanges within the conversation.'],
                  [<Hand size={13} />, 'Punch', 'A single turn — one message sent or received', 'User sends a jab → that\'s 1 punch. Kai fires back → another punch. Ding ding.'],
                ].map(([icon, term, def_, joke], i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.5rem', fontWeight: 600, verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>{icon} {term}</span>
                    </td>
                    <td style={{ padding: '0.5rem', verticalAlign: 'top' }}>
                      <div>{def_}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '0.2rem' }}>{joke}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: '0.5rem', padding: '0.4rem 0.6rem', background: 'var(--bg-hover)', borderRadius: '4px', fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
              Superfight &gt; Fighter &gt; Bout (=Match) &gt; Round &gt; Punch (=Turn)
            </div>
            <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.6rem', background: 'var(--orange)10', border: '1px solid var(--orange)30', borderRadius: '4px', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
              <Zap size={11} style={{ color: 'var(--orange)', verticalAlign: 'middle', marginRight: '0.25rem' }} />
              <strong>Unlike real boxing</strong> — one fighter can be in multiple bouts at the same time.
              That's xPower: like opening 4 chat windows and talking to Kai in all of them simultaneously.
              In the real ring, that'd be cheating. Here, it's called "load testing."
            </div>
          </div>
        </div>

        {/* Equivalence */}
        <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: 'var(--bg-primary)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.4rem', fontWeight: 600 }}>EQUIVALENCE TABLE</div>
          <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '0.35rem 0.5rem', color: 'var(--accent)' }}>Single-User</th>
                <th style={{ textAlign: 'left', padding: '0.35rem 0.5rem', color: 'var(--red)' }}>Load Test</th>
                <th style={{ textAlign: 'left', padding: '0.35rem 0.5rem', color: 'var(--text-muted)' }}>Generic</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Match', 'Bout', 'Conversation'],
                ['Round', 'Round', 'Segment / topic block'],
                ['Exchange', 'Punch', 'User msg + Kai response'],
                ['—', 'Fighter', 'Test user'],
                ['—', 'xPower', 'Concurrency multiplier'],
                ['—', 'Superfight', 'Load test event'],
              ].map(([single, load, generic], i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.35rem 0.5rem', fontWeight: 500 }}>{single}</td>
                  <td style={{ padding: '0.35rem 0.5rem', fontWeight: 500 }}>{load}</td>
                  <td style={{ padding: '0.35rem 0.5rem', color: 'var(--text-secondary)' }}>{generic}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* The Formula */}
        <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: 'var(--bg-primary)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>THE SUPERFIGHT FORMULA</div>
          <div style={{ fontSize: '1rem', fontFamily: 'monospace', fontWeight: 600 }}>
            <span style={{ color: 'var(--accent)' }}>N fighters</span>
            {' x '}
            <span style={{ color: 'var(--orange)' }}>M xPower</span>
            {' = '}
            <span style={{ color: 'var(--green)' }}>N*M bouts</span>
            {' x '}
            <span style={{ color: 'var(--blue)' }}>R rounds</span>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
            Example: 5 fighters x 4 xPower = 20 bouts x 6 rounds = 120 total punches thrown at Kai
          </div>
        </div>
      </div>

      {/* Fight Modes */}
      <div id="fight-modes" className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Shuffle size={16} /> Fight Styles (Test Modes)
        </h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          Every boxer has a style. So do our test actors.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
          {[
            {
              icon: <ClipboardList size={24} />, name: 'Fixed', color: 'var(--green)',
              desc: 'Predefined scenarios, no improvisation.',
              joke: 'The textbook fighter. Throws the exact same combo every time. Predictable, but great for regression testing.',
            },
            {
              icon: <Flame size={24} />, name: 'Fire', color: 'var(--red)',
              desc: 'Preset plan, fully autonomous execution.',
              joke: 'Walks in with a game plan, executes it without looking back. Like a fire-and-forget missile, but for conversations.',
            },
            {
              icon: <Compass size={24} />, name: 'Explore', color: 'var(--accent)',
              desc: 'No plan. AI decides every move dynamically.',
              joke: 'The jazz improviser of testing. Goes wherever the conversation takes it. Sometimes finds gold. Sometimes finds bugs. Always finds something.',
            },
            {
              icon: <Shuffle size={24} />, name: 'Hybrid', color: 'var(--orange)',
              desc: 'AI makes a plan, then adapts on the fly.',
              joke: 'Starts with strategy, pivots when Kai does something unexpected. The thinking person\'s test mode.',
            },
          ].map(m => (
            <div key={m.name} style={{
              background: 'var(--bg-primary)', borderRadius: 'var(--radius)', padding: '0.75rem',
              borderTop: `3px solid ${m.color}`,
            }}>
              <div style={{ marginBottom: '0.3rem', color: m.color }}>{m.icon}</div>
              <div style={{ fontWeight: 600, fontSize: '0.85rem', color: m.color, marginBottom: '0.25rem' }}>{m.name}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>{m.desc}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{m.joke}</div>
            </div>
          ))}
        </div>

        {/* Under the Hood — How each mode works */}
        <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: 'var(--bg-primary)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 600 }}>UNDER THE HOOD</div>
          <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600 }}></th>
                <th style={{ textAlign: 'center', padding: '0.4rem 0.5rem', color: 'var(--green)', fontWeight: 600 }}>Fixed</th>
                <th style={{ textAlign: 'center', padding: '0.4rem 0.5rem', color: 'var(--red)', fontWeight: 600 }}>Fire</th>
                <th style={{ textAlign: 'center', padding: '0.4rem 0.5rem', color: 'var(--accent)', fontWeight: 600 }}>Explore</th>
                <th style={{ textAlign: 'center', padding: '0.4rem 0.5rem', color: 'var(--orange)', fontWeight: 600 }}>Hybrid</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Brain', 'None (scripted)', 'Claude (autonomous)', 'Claude (per-turn)', 'Claude (per-turn)'],
                ['Who controls turns?', 'Python loop', 'Claude decides everything', 'Python loop', 'Python loop'],
                ['Planning', 'Pre-written script', 'Claude decides on the fly', 'No plan — improvises', 'Pre-generates plan, then adapts'],
                ['Kai interaction', 'Python KaiClient directly', 'Bash → kai_conversation.py', 'Python KaiClient directly', 'Python KaiClient directly'],
                ['Evaluation', 'Server-side rubric', 'Claude self-evaluates', 'Server-side rubric', 'Server-side rubric'],
                ['Claude usage', 'None', '1 long session (all turns)', '1 call per turn', '1 plan call + 1 per turn'],
                ['Best for', 'Regression, CI/CD', 'Fully hands-off testing', 'Discovery, edge cases', 'Structured but adaptive testing'],
              ].map(([label, ...vals], i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.4rem 0.5rem', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{label}</td>
                  {vals.map((v, j) => (
                    <td key={j} style={{ padding: '0.4rem 0.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '0.5rem' }}>
            <strong>Key difference:</strong> Fire mode gives Claude full autonomy — it spawns a subprocess, runs all turns via bash, and self-reports.
            Explore and Hybrid both keep Python in the driver's seat, only asking Claude to generate the next message each turn.
          </div>
        </div>
      </div>

      {/* Weight Classes */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Dumbbell size={16} /> Weight Classes (Load Levels)
        </h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          How hard do you want to hit Kai? Pick your weight class.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5rem' }}>
          {[
            { icon: <Feather size={24} />, name: 'Flyweight', range: '1-5 bouts', desc: 'Smoke test. Just checking Kai is alive and wearing its gloves.', vibe: 'Gentle tap' },
            { icon: <PersonStanding size={24} />, name: 'Featherweight', range: '5-15 bouts', desc: 'Light sparring. Multiple users, seeing if the basics hold.', vibe: 'Warm-up' },
            { icon: <Swords size={24} />, name: 'Middleweight', range: '15-30 bouts', desc: 'Real fight. Normal production-like load.', vibe: 'Game day' },
            { icon: <Dumbbell size={24} />, name: 'Heavyweight', range: '30-60 bouts', desc: 'Stress test. Can Kai think straight with 60 conversations?', vibe: 'Pain zone' },
            { icon: <Flame size={24} />, name: 'Superfight', range: '60-100+ bouts', desc: 'The main event. If Kai survives this, it\'s championship material.', vibe: 'Total chaos' },
          ].map(w => (
            <div key={w.name} style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius)', padding: '0.6rem', textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.3rem', color: 'var(--text-secondary)' }}>{w.icon}</div>
              <div style={{ fontWeight: 600, fontSize: '0.78rem', marginBottom: '0.15rem' }}>{w.name}</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--accent)', fontWeight: 500, marginBottom: '0.3rem' }}>{w.range}</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>{w.desc}</div>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{w.vibe}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Scoring */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Target size={16} /> Scoring System (The Judges' Table)
        </h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          We don't grade on a curve. We grade against the best in the business.
          If ChatGPT, Copilot, Gemini, and Claude can do it fast, so should Kai. No excuses.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
          {/* Latency */}
          <div>
            <h4 style={{ fontSize: '0.82rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <Timer size={14} /> Speed Scoring
            </h4>
            <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '0.4rem' }}>Tier</th>
                  <th style={{ textAlign: 'left', padding: '0.4rem' }}>TTFT</th>
                  <th style={{ textAlign: 'left', padding: '0.4rem' }}>Full Answer</th>
                  <th style={{ textAlign: 'center', padding: '0.4rem' }}>Score</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Excellent', '<500ms', '<5s', '5', '#22c55e', 'Lightning. Kai didn\'t even blink.'],
                  ['Good', '<1s', '<10s', '4', '#84cc16', 'Competitive with the big names.'],
                  ['Acceptable', '<2s', '<20s', '3', '#eab308', 'Users notice the delay. Coffee break territory.'],
                  ['Critical', '>2s', '>20s', '1', '#ef4444', 'Is Kai still alive? Someone check its pulse.'],
                ].map(([tier, ttft, total, score, color, joke]) => (
                  <tr key={tier} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.4rem', fontWeight: 600, color }}>{tier}</td>
                    <td style={{ padding: '0.4rem', fontFamily: 'monospace' }}>{ttft}</td>
                    <td style={{ padding: '0.4rem', fontFamily: 'monospace' }}>{total}</td>
                    <td style={{ padding: '0.4rem', textAlign: 'center', fontWeight: 600 }}>{score}/5</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '0.3rem' }}>
              Based on Nielsen Norman Group perception thresholds, Google UX benchmarks, and Forrester abandon rate research.
              If 73% of users leave after 5 seconds, we can't be serving responses in 47 seconds.
            </div>
          </div>

          {/* Quality */}
          <div>
            <h4 style={{ fontSize: '0.82rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <Star size={14} /> Quality Scoring
            </h4>
            <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '0.4rem' }}>Metric</th>
                  <th style={{ textAlign: 'left', padding: '0.4rem' }}>5/5 means...</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Relevance', 'Zero filler. Every sentence earns its place. No "As an AI, I..." nonsense.'],
                  ['Accuracy', 'Every claim is verifiable. Real IDs, real numbers. No creative fiction.'],
                  ['Helpfulness', 'Task is DONE. No follow-up needed. Kai just... did the thing.'],
                  ['Tool Usage', 'Perfect tool selection, minimal API calls. Surgical precision.'],
                ].map(([metric, desc]) => (
                  <tr key={metric} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.4rem', fontWeight: 600 }}>{metric}</td>
                    <td style={{ padding: '0.4rem', color: 'var(--text-secondary)' }}>{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '0.3rem' }}>
              A score of 4+ is genuinely impressive. Most AI responses land at 2-4.
              If you're giving out 5s like candy, you're being too nice. This is a fight, not a participation trophy ceremony.
            </div>
          </div>
        </div>

        {/* Grade Bands */}
        <h4 style={{ fontSize: '0.82rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <Medal size={14} /> Grade Bands
        </h4>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {[
            { grade: 'A+', min: '4.7', label: 'Best-in-class', color: '#22c55e', joke: 'Kai is throwing haymakers. Ship it.' },
            { grade: 'A', min: '4.2', label: 'Strong', color: '#4ade80', joke: 'Competitive with the champions. Minor polish.' },
            { grade: 'B', min: '3.5', label: 'Good', color: '#84cc16', joke: 'Solid performance, but the competition is fiercer.' },
            { grade: 'C', min: '2.8', label: 'Needs Work', color: '#eab308', joke: 'Below market average. Back to training camp.' },
            { grade: 'D', min: '2.0', label: 'Below Standard', color: '#f97316', joke: 'Significant issues. Corner might throw the towel.' },
            { grade: 'F', min: '<2.0', label: 'Failing', color: '#ef4444', joke: 'TKO. Fundamental problems. Not ready for the ring.' },
          ].map(g => (
            <div key={g.grade} style={{
              flex: '1 1 140px', padding: '0.5rem 0.6rem', borderRadius: 'var(--radius)',
              background: `${g.color}10`, border: `1px solid ${g.color}30`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.2rem' }}>
                <span style={{ fontWeight: 700, fontSize: '1rem', color: g.color }}>{g.grade}</span>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{g.min}+</span>
              </div>
              <div style={{ fontSize: '0.72rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{g.label}</div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{g.joke}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Competitors */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <BarChart3 size={16} /> The Competition (Who We're Fighting)
        </h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          We benchmark Kai against the heavyweight champions of the AI world.
          Not because it's fair — but because that's who our users compare us to.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
          {[
            { name: 'ChatGPT-4o', ttfb: '~800ms', total: '~12s', quality: '4.2', color: '#22c55e' },
            { name: 'Copilot M365', ttfb: '~1.2s', total: '~15s', quality: '3.8', color: '#2563eb' },
            { name: 'Gemini Pro', ttfb: '~600ms', total: '~10s', quality: '4.0', color: '#eab308' },
            { name: 'Claude Sonnet', ttfb: '~700ms', total: '~12s', quality: '4.3', color: '#a855f7' },
          ].map(c => (
            <div key={c.name} style={{ background: 'var(--bg-primary)', borderRadius: 'var(--radius)', padding: '0.6rem', textAlign: 'center' }}>
              <Circle size={20} fill={c.color} stroke={c.color} style={{ marginBottom: '0.3rem' }} />
              <div style={{ fontWeight: 600, fontSize: '0.78rem', marginBottom: '0.3rem' }}>{c.name}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>TTFT: <strong>{c.ttfb}</strong></div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Full Answer: <strong>{c.total}</strong></div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Quality: <strong>{c.quality}/5</strong></div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '0.5rem', textAlign: 'center' }}>
          Sources: Artificial Analysis, public benchmarks, enterprise reports (2025-2026).
          These are complex agentic queries with tool execution — not simple chatbot pings.
        </div>
      </div>

      {/* How it works */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Wrench size={16} /> How It Actually Works
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <h4 style={{ fontSize: '0.82rem', marginBottom: '0.5rem' }}>Match Flow (Single-User)</h4>
            <ol style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.8, paddingLeft: '1.25rem' }}>
              <li><strong>Pick a fight style</strong> — Fire, Explore, Hybrid, or Fixed</li>
              <li><strong>Claude Code</strong> starts a match with Kai</li>
              <li>Each round: Claude sends a message, Kai responds</li>
              <li>Claude evaluates each response in real-time</li>
              <li>After all rounds: full evaluation report with grades</li>
              <li>HTML report with charts, benchmarks, and competitor comparison</li>
            </ol>
          </div>
          <div>
            <h4 style={{ fontSize: '0.82rem', marginBottom: '0.5rem' }}>Superfight Flow (Load Test)</h4>
            <ol style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.8, paddingLeft: '1.25rem' }}>
              <li><strong>Scout fighters</strong> — provision test users in Talent Scouting</li>
              <li><strong>Pick a weight class</strong> — how many bouts do you want</li>
              <li><strong>Configure</strong> — fighters, xPower, rounds, ramp-up</li>
              <li>All fighters authenticate and start talking to Kai simultaneously</li>
              <li>Live monitoring: latency, errors, throughput, per-bout detail</li>
              <li><strong>Benchmark grade</strong> — same A+ to F scoring as single matches</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
