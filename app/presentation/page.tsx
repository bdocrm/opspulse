'use client';

import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Play, Pause } from 'lucide-react';

interface Slide {
  id: number;
  title: string;
  subtitle?: string;
  content: React.ReactNode;
}

const slides: Slide[] = [
  {
    id: 1,
    title: 'OpsView 360',
    subtitle: 'Operational Performance Intelligence Dashboard',
    content: (
      <div className="text-center space-y-6">
        <div className="text-6xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
          OpsView 360
        </div>
        <p className="text-2xl text-gray-600 dark:text-gray-300">
          Real-time operational performance monitoring & analytics
        </p>
        <p className="text-lg text-gray-500 dark:text-gray-400">
          Developed by Business Dev Team
        </p>
      </div>
    ),
  },
  {
    id: 2,
    title: 'What is OpsView?',
    content: (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-blue-50 dark:bg-blue-900/20 p-6 rounded-lg border border-blue-200 dark:border-blue-800">
            <h3 className="text-xl font-bold text-blue-900 dark:text-blue-100 mb-3">
              📊 Performance Tracking
            </h3>
            <p className="text-gray-700 dark:text-gray-300">
              Monitor real-time KPIs across multiple campaigns and agents
            </p>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 p-6 rounded-lg border border-green-200 dark:border-green-800">
            <h3 className="text-xl font-bold text-green-900 dark:text-green-100 mb-3">
              👥 Team Management
            </h3>
            <p className="text-gray-700 dark:text-gray-300">
              Manage agents, collectors, and operations managers across campaigns
            </p>
          </div>
          <div className="bg-purple-50 dark:bg-purple-900/20 p-6 rounded-lg border border-purple-200 dark:border-purple-800">
            <h3 className="text-xl font-bold text-purple-900 dark:text-purple-100 mb-3">
              📈 Data Analytics
            </h3>
            <p className="text-gray-700 dark:text-gray-300">
              Advanced charting and trend analysis with custom date filters
            </p>
          </div>
          <div className="bg-orange-50 dark:bg-orange-900/20 p-6 rounded-lg border border-orange-200 dark:border-orange-800">
            <h3 className="text-xl font-bold text-orange-900 dark:text-orange-100 mb-3">
              🔐 Role-Based Access
            </h3>
            <p className="text-gray-700 dark:text-gray-300">
              Secure multi-role system with granular permissions
            </p>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 3,
    title: 'Technology Stack',
    content: (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: 'Framework', value: 'Next.js 14 (App Router)' },
            { label: 'Language', value: 'TypeScript' },
            { label: 'Styling', value: 'TailwindCSS + ShadCN UI' },
            { label: 'Charts', value: 'Recharts' },
            { label: 'Database', value: 'Supabase PostgreSQL' },
            { label: 'Auth', value: 'NextAuth (Credentials + Roles)' },
            { label: 'ORM', value: 'Prisma' },
            { label: 'Deployment', value: 'Vercel' },
          ].map((item, idx) => (
            <div
              key={idx}
              className="bg-gradient-to-br from-slate-100 to-slate-50 dark:from-slate-800 dark:to-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-700"
            >
              <p className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                {item.label}
              </p>
              <p className="text-slate-600 dark:text-slate-400 text-xs mt-1">
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 4,
    title: 'Key Features',
    content: (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            '✅ Live Dashboard with KPI Cards',
            '📊 Multi-type Charts (Bar, Line, Pie)',
            '🏆 Agent Leaderboard & Rankings',
            '📱 Fully Responsive Design',
            '🔍 Campaign Deep-Dive Analytics',
            '📥 Data Entry & Bulk Import',
            '📤 CSV/Excel Export',
            '🌙 Dark/Light Mode Support',
            '📅 Multiple Time Period Filters',
            '👤 Individual Agent Metrics',
            '🎯 Dynamic Campaign KPIs',
            '🔒 Role-Based Access Control',
          ].map((feature, idx) => (
            <div
              key={idx}
              className="flex items-center space-x-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition"
            >
              <span className="text-lg">{feature.split(' ')[0]}</span>
              <span className="text-gray-700 dark:text-gray-300">
                {feature.substring(3)}
              </span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 5,
    title: 'Role-Based Access Control',
    content: (
      <div className="space-y-4">
        {[
          {
            role: '👑 CEO',
            access: 'Global access to all campaigns',
            color: 'from-yellow-100 to-orange-100 dark:from-yellow-900/20 dark:to-orange-900/20',
            border: 'border-yellow-300 dark:border-yellow-700',
          },
          {
            role: '📊 OM (Operations Manager)',
            access: 'Campaign-specific data review and approval',
            color: 'from-blue-100 to-cyan-100 dark:from-blue-900/20 dark:to-cyan-900/20',
            border: 'border-blue-300 dark:border-blue-700',
          },
          {
            role: '📝 COLLECTOR',
            access: 'Data entry and agent management',
            color: 'from-green-100 to-emerald-100 dark:from-green-900/20 dark:to-emerald-900/20',
            border: 'border-green-300 dark:border-green-700',
          },
          {
            role: '👤 AGENT',
            access: 'Submit daily performance metrics',
            color: 'from-purple-100 to-pink-100 dark:from-purple-900/20 dark:to-pink-900/20',
            border: 'border-purple-300 dark:border-purple-700',
          },
        ].map((item, idx) => (
          <div
            key={idx}
            className={`bg-gradient-to-r ${item.color} border ${item.border} p-5 rounded-lg`}
          >
            <h3 className="font-bold text-lg mb-2">{item.role}</h3>
            <p className="text-gray-700 dark:text-gray-300">{item.access}</p>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 6,
    title: 'Campaign Management',
    content: (
      <div className="space-y-6">
        <p className="text-lg text-gray-700 dark:text-gray-300">
          Manage 6 Major Campaigns:
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            'BPI PA OUTBOUND',
            'BPI PA INBOUND',
            'BPI PL',
            'MB ACQ',
            'BDO SGM',
            'BPI BI',
          ].map((campaign, idx) => (
            <div
              key={idx}
              className="bg-gradient-to-br from-indigo-500 to-blue-600 text-white p-4 rounded-lg font-semibold text-center hover:shadow-lg transition"
            >
              {campaign}
            </div>
          ))}
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800 mt-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Each campaign can have its own KPI metrics, agents, and collectors for targeted performance monitoring
          </p>
        </div>
      </div>
    ),
  },
  {
    id: 7,
    title: 'Dashboard Features',
    content: (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 p-6 rounded-lg border border-slate-200 dark:border-slate-700">
            <h3 className="font-bold text-lg mb-3">📊 Visualizations</h3>
            <ul className="space-y-2 text-sm">
              <li>• KPI Performance Cards</li>
              <li>• Bar Charts (Campaign Comparison)</li>
              <li>• Line Charts (Trends)</li>
              <li>• Pie Charts (Distribution)</li>
              <li>• Leaderboards</li>
            </ul>
          </div>
          <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 p-6 rounded-lg border border-slate-200 dark:border-slate-700">
            <h3 className="font-bold text-lg mb-3">⚙️ Filters & Controls</h3>
            <ul className="space-y-2 text-sm">
              <li>• Daily Performance View</li>
              <li>• Weekly Breakdown</li>
              <li>• Monthly Analysis</li>
              <li>• Yearly Trends</li>
              <li>• Campaign Selection</li>
            </ul>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 8,
    title: 'Data Management',
    content: (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-6 rounded-lg">
            <h3 className="font-bold text-lg mb-3">📥 Data Input Methods</h3>
            <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
              <li>✓ Manual Data Entry</li>
              <li>✓ Bulk CSV Import</li>
              <li>✓ Agent Performance Submit</li>
              <li>✓ Real-time Updates</li>
            </ul>
          </div>
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-6 rounded-lg">
            <h3 className="font-bold text-lg mb-3">📤 Export Options</h3>
            <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
              <li>✓ CSV Export</li>
              <li>✓ Excel Download</li>
              <li>✓ Campaign Reports</li>
              <li>✓ Custom Date Ranges</li>
            </ul>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 9,
    title: 'KPI Metrics',
    content: (
      <div className="space-y-4">
        <p className="text-gray-700 dark:text-gray-300 mb-4">
          Dynamic KPI computation based on campaign configuration:
        </p>
        <div className="space-y-3">
          {[
            { metric: 'Conversion Rate', formula: 'Successful Conversions / Total Attempts' },
            { metric: 'Agent Performance', formula: 'Individual Agent KPI Contribution' },
            { metric: 'Campaign Target', formula: 'Actual vs Target Achievement' },
            { metric: 'Daily Average', formula: 'Total Metric / Number of Days' },
            { metric: 'Growth Trend', formula: 'Day-over-Day Performance Change' },
          ].map((item, idx) => (
            <div
              key={idx}
              className="bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-700"
            >
              <div className="font-bold text-slate-900 dark:text-slate-100">
                {item.metric}
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                {item.formula}
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 10,
    title: 'User Experience',
    content: (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-purple-50 dark:bg-purple-900/20 p-6 rounded-lg border border-purple-200 dark:border-purple-800">
            <h3 className="font-bold text-lg mb-3">🎨 Design</h3>
            <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
              <li>• Dark/Light Mode</li>
              <li>• Modern UI Components</li>
              <li>• Smooth Animations</li>
              <li>• Clean Typography</li>
            </ul>
          </div>
          <div className="bg-pink-50 dark:bg-pink-900/20 p-6 rounded-lg border border-pink-200 dark:border-pink-800">
            <h3 className="font-bold text-lg mb-3">📱 Responsiveness</h3>
            <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
              <li>• Desktop Sidebar Navigation</li>
              <li>• Tablet Collapsible Menu</li>
              <li>• Mobile Drawer + Bottom Nav</li>
              <li>• Touch-Friendly Controls</li>
            </ul>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 11,
    title: 'Agent Performance Tracking',
    content: (
      <div className="space-y-4">
        <p className="text-gray-700 dark:text-gray-300 mb-4">
          Comprehensive agent management and performance monitoring:
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 p-5 rounded-lg border border-blue-200 dark:border-blue-800">
            <h3 className="font-bold mb-2">👥 Agent Management</h3>
            <ul className="text-sm space-y-1 text-gray-700 dark:text-gray-300">
              <li>• Add/Edit Agents</li>
              <li>• Seat Number Assignment</li>
              <li>• Campaign Assignment</li>
              <li>• Status Tracking</li>
            </ul>
          </div>
          <div className="bg-orange-50 dark:bg-orange-900/20 p-5 rounded-lg border border-orange-200 dark:border-orange-800">
            <h3 className="font-bold mb-2">📈 Performance Analytics</h3>
            <ul className="text-sm space-y-1 text-gray-700 dark:text-gray-300">
              <li>• Individual Leaderboards</li>
              <li>• Daily Trends</li>
              <li>• Performance Comparison</li>
              <li>• Achievement Tracking</li>
            </ul>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 12,
    title: 'Security & Compliance',
    content: (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-red-50 dark:bg-red-900/20 p-6 rounded-lg border border-red-200 dark:border-red-800">
            <h3 className="font-bold text-lg mb-3">🔐 Authentication</h3>
            <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
              <li>✓ NextAuth Integration</li>
              <li>✓ Credential-based Login</li>
              <li>✓ Session Management</li>
              <li>✓ Secure Password Handling</li>
            </ul>
          </div>
          <div className="bg-teal-50 dark:bg-teal-900/20 p-6 rounded-lg border border-teal-200 dark:border-teal-800">
            <h3 className="font-bold text-lg mb-3">🛡️ Authorization</h3>
            <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
              <li>✓ Role-Based Access</li>
              <li>✓ Campaign Isolation</li>
              <li>✓ Permission Checking</li>
              <li>✓ Audit Trails</li>
            </ul>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 13,
    title: 'Getting Started',
    content: (
      <div className="space-y-4">
        <div className="bg-slate-900 dark:bg-slate-800 text-white p-6 rounded-lg font-mono text-sm space-y-3">
          <p>
            <span className="text-green-400">$</span> npm install
          </p>
          <p>
            <span className="text-green-400">$</span> cp .env.example .env
          </p>
          <p>
            <span className="text-green-400">$</span> npx prisma db push
          </p>
          <p>
            <span className="text-green-400">$</span> npx prisma db seed
          </p>
          <p>
            <span className="text-green-400">$</span> npm run dev
          </p>
        </div>
        <p className="text-gray-600 dark:text-gray-400 text-sm">
          Open http://localhost:3000
        </p>
      </div>
    ),
  },
  {
    id: 14,
    title: 'Default Credentials',
    content: (
      <div className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-200 dark:bg-slate-700">
              <tr>
                <th className="px-4 py-2 text-left font-bold">Role</th>
                <th className="px-4 py-2 text-left font-bold">Email</th>
                <th className="px-4 py-2 text-left font-bold">Password</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              <tr className="bg-blue-50 dark:bg-blue-900/20">
                <td className="px-4 py-2">CEO</td>
                <td className="px-4 py-2">ceo@opsview.com</td>
                <td className="px-4 py-2 font-mono">password123</td>
              </tr>
              <tr className="bg-green-50 dark:bg-green-900/20">
                <td className="px-4 py-2">OM (Example)</td>
                <td className="px-4 py-2">om.bpi.out@opsview.com</td>
                <td className="px-4 py-2 font-mono">password123</td>
              </tr>
              <tr className="bg-orange-50 dark:bg-orange-900/20">
                <td className="px-4 py-2">COLLECTOR (Example)</td>
                <td className="px-4 py-2">collector.bpi.out@opsview.com</td>
                <td className="px-4 py-2 font-mono">password123</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          All campaigns follow the same naming pattern with their respective campaign codes
        </p>
      </div>
    ),
  },
  {
    id: 15,
    title: 'Summary',
    subtitle: 'Key Takeaways',
    content: (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-gradient-to-br from-blue-500 to-blue-600 text-white p-6 rounded-lg">
            <div className="text-4xl font-bold mb-2">📊</div>
            <p className="font-semibold">Real-time Performance Monitoring</p>
          </div>
          <div className="bg-gradient-to-br from-green-500 to-green-600 text-white p-6 rounded-lg">
            <div className="text-4xl font-bold mb-2">👥</div>
            <p className="font-semibold">Multi-Role Team Management</p>
          </div>
          <div className="bg-gradient-to-br from-purple-500 to-purple-600 text-white p-6 rounded-lg">
            <div className="text-4xl font-bold mb-2">📈</div>
            <p className="font-semibold">Advanced Analytics & Insights</p>
          </div>
          <div className="bg-gradient-to-br from-orange-500 to-orange-600 text-white p-6 rounded-lg">
            <div className="text-4xl font-bold mb-2">🔒</div>
            <p className="font-semibold">Secure & Scalable Architecture</p>
          </div>
        </div>
        <p className="text-center text-lg font-semibold text-gray-700 dark:text-gray-300 mt-6">
          Thank You! 🎉
        </p>
      </div>
    ),
  },
];

export default function PresentationPage() {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isAutoPlay, setIsAutoPlay] = useState(false);

  useEffect(() => {
    if (!isAutoPlay) return;

    const interval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % slides.length);
    }, 5000);

    return () => clearInterval(interval);
  }, [isAutoPlay]);

  const handlePrevious = () => {
    setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
  };

  const handleNext = () => {
    setCurrentSlide((prev) => (prev + 1) % slides.length);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') handlePrevious();
    if (e.key === 'ArrowRight') handleNext();
    if (e.key === ' ') {
      e.preventDefault();
      setIsAutoPlay(!isAutoPlay);
    }
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAutoPlay]);

  const slide = slides[currentSlide];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 flex flex-col">
      {/* Slide Content */}
      <div className="flex-1 flex items-center justify-center px-4 py-8 md:py-12">
        <div className="w-full max-w-5xl">
          {/* Slide Container */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-8 md:p-12 min-h-96 flex flex-col justify-center">
            {/* Title */}
            <div className="mb-8">
              <h1 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-2">
                {slide.title}
              </h1>
              {slide.subtitle && (
                <p className="text-xl text-gray-600 dark:text-gray-300">
                  {slide.subtitle}
                </p>
              )}
              {currentSlide > 0 && (
                <div className="h-1 w-20 bg-gradient-to-r from-blue-500 to-cyan-500 mt-4 rounded-full"></div>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 text-gray-700 dark:text-gray-300">
              {slide.content}
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 px-4 py-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          {/* Slide Counter */}
          <div className="text-sm font-medium text-gray-600 dark:text-gray-400">
            <span className="text-blue-600 dark:text-blue-400 font-bold">
              {currentSlide + 1}
            </span>
            <span> / {slides.length}</span>
          </div>

          {/* Navigation Buttons */}
          <div className="flex items-center gap-4">
            <button
              onClick={handlePrevious}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
              title="Previous (←)"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>

            <button
              onClick={() => setIsAutoPlay(!isAutoPlay)}
              className={`p-2 rounded-lg transition ${
                isAutoPlay
                  ? 'bg-blue-500 text-white hover:bg-blue-600'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
              title="Play/Pause (Space)"
            >
              {isAutoPlay ? (
                <Pause className="w-6 h-6" />
              ) : (
                <Play className="w-6 h-6" />
              )}
            </button>

            <button
              onClick={handleNext}
              className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
              title="Next (→)"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </div>

          {/* Progress Bar */}
          <div className="hidden md:block flex-1 mx-6">
            <div className="w-full h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 transition-all duration-300"
                style={{ width: `${((currentSlide + 1) / slides.length) * 100}%` }}
              ></div>
            </div>
          </div>

          {/* Help Text */}
          <div className="text-xs text-gray-500 dark:text-gray-400 hidden sm:block">
            <span>Use ← → or Space</span>
          </div>
        </div>
      </div>

      {/* Keyboard Instructions */}
      <div className="bg-slate-100 dark:bg-slate-900 px-4 py-3 text-center text-xs text-gray-600 dark:text-gray-400">
        💡 Keyboard: ← → Navigate | Space Autoplay
      </div>
    </div>
  );
}
