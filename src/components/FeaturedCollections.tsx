import { Link } from '@tanstack/react-router'

type Collection = {
  title: string
  emoji: string
  description: string
  tags: string[]
  searchQuery: string
  accent: string
}

const COLLECTIONS: Collection[] = [
  {
    title: 'Sports & Betting',
    emoji: '🏀',
    description: 'Odds comparison, DFS optimizers, Kelly sizing, streak analysis, and live scores.',
    tags: ['odds', 'nfl', 'nba', 'dfs', 'kelly', 'sports'],
    searchQuery: 'sports betting odds nba nfl',
    accent: '#22c55e',
  },
  {
    title: 'Finance & Crypto',
    emoji: '₿',
    description: 'Portfolio rebalancers, price trackers, market sentiment, and DeFi tooling.',
    tags: ['crypto', 'portfolio', 'nft', 'defi', 'bitcoin'],
    searchQuery: 'crypto portfolio finance bitcoin',
    accent: '#f59e0b',
  },
  {
    title: 'Developer Tools',
    emoji: '🛠',
    description: 'Git helpers, security scanners, code review, CI integrations, and CLI utilities.',
    tags: ['git', 'security', 'ci', 'code', 'terminal'],
    searchQuery: 'git security code developer',
    accent: '#3b82f6',
  },
  {
    title: 'AI & Agents',
    emoji: '🤖',
    description: 'LLM wrappers, prompt enhancers, agent orchestrators, and AI workflow helpers.',
    tags: ['llm', 'prompt', 'agent', 'openai', 'claude'],
    searchQuery: 'ai agent llm prompt',
    accent: '#a855f7',
  },
  {
    title: 'Productivity',
    emoji: '⚡',
    description: 'Task management, note-taking bridges, calendar tools, and focus utilities.',
    tags: ['tasks', 'notes', 'notion', 'obsidian', 'calendar'],
    searchQuery: 'productivity tasks notes notion',
    accent: '#06b6d4',
  },
  {
    title: 'Data & Visualization',
    emoji: '📊',
    description: 'CSV/JSON charting, dashboards, analytics pipelines, and reporting tools.',
    tags: ['charts', 'csv', 'data', 'viz', 'analytics'],
    searchQuery: 'data visualization charts csv',
    accent: '#ec4899',
  },
]

function CollectionCard({ col }: { col: Collection }) {
  const searchLink = {
    to: '/skills' as const,
    search: {
      q: col.searchQuery,
      sort: 'downloads' as const,
      dir: 'desc' as const,
      highlighted: undefined,
      nonSuspicious: true as const,
      view: undefined,
      focus: undefined,
    },
  }

  return (
    <Link
      {...searchLink}
      className="card collection-card"
      style={{ '--collection-accent': col.accent } as React.CSSProperties}
    >
      <div className="collection-emoji">{col.emoji}</div>
      <h3 className="collection-title">{col.title}</h3>
      <p className="collection-desc">{col.description}</p>
      <div className="collection-tags">
        {col.tags.slice(0, 4).map((tag) => (
          <span key={tag} className="collection-tag">
            {tag}
          </span>
        ))}
        {col.tags.length > 4 && (
          <span className="collection-tag collection-tag-more">+{col.tags.length - 4}</span>
        )}
      </div>
    </Link>
  )
}

export function FeaturedCollections() {
  return (
    <section className="section">
      <h2 className="section-title">Browse by category</h2>
      <p className="section-subtitle">Jump straight to the skills that match your workflow.</p>
      <div className="grid collections-grid">
        {COLLECTIONS.map((col) => (
          <CollectionCard key={col.title} col={col} />
        ))}
      </div>
    </section>
  )
}
