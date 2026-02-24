'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

// ──────────────────── Types ────────────────────

interface LogEntry {
  id: string
  time: string
  type: 'action' | 'finding' | 'photo' | 'system' | 'note'
  step?: number
  text: string
  photo?: string
}

interface StepState {
  status: 'pending' | 'active' | 'done' | 'skipped'
  result?: 'success' | 'fail' | 'unclear'
  notes: string
  startTime?: number
  elapsed?: number
}

type View = 'wizard' | 'log' | 'camera' | 'specs' | 'report'

// ──────────────────── Diagnostic Tree ────────────────────

interface DiagNode {
  id: number
  title: string
  icon: string
  tag: string
  time: string
  instruction: string[]
  ask: string
  yes: { text: string; next: number | 'done'; msg: string }
  no: { text: string; next: number | 'done'; msg: string }
  maybe?: { text: string; next: number | 'done'; msg: string }
  tip?: string
  warning?: string
  photo?: boolean
}

const DIAG_TREE: DiagNode[] = [
  {
    id: 0,
    title: '释放静电',
    icon: '⚡',
    tag: '零成本',
    time: '1分钟',
    instruction: [
      '❶ 关机 → 长按电源键10秒强制关机',
      '❷ 拔掉电源适配器',
      '❸ 拔掉所有外接设备（USB/Type-C/HDMI全拔）',
      '❹ 长按电源键 20~30秒',
      '❺ 松手，等10秒',
      '❻ 仅插电源适配器',
      '❼ 按电源键开机',
    ],
    ask: '释放静电后能正常开机了吗？',
    yes: { text: '能开机了！', next: 'done', msg: '🎉 静电问题已解决！建议检查接地线和用电环境。' },
    no: { text: '还是不行', next: 1, msg: '排除静电，继续下一步。' },
    tip: '机械革命CODE01实测：释放静电后直接恢复！成功率极高。',
  },
  {
    id: 1,
    title: '检查电源适配器',
    icon: '🔌',
    tag: '零成本',
    time: '2分钟',
    instruction: [
      '❶ 检查适配器指示灯是否亮',
      '❷ 检查电源线有无破损/折痕',
      '❸ 检查DC/Type-C充电口是否松动、有异物',
      '❹ 如有条件，换一个同规格适配器试试',
      '❺ 插电后，开机键旁的灯有反应吗？',
    ],
    ask: '插上电源适配器后，有任何灯亮或风扇转吗？',
    yes: { text: '有反应', next: 2, msg: '电源OK，问题在别处。' },
    no: { text: '完全没反应', next: 5, msg: '可能是电源/主板供电回路问题。需要拆机检查。' },
    maybe: { text: '灯闪一下就灭', next: 3, msg: '典型电池或主板问题。' },
    warning: '确保使用原装或同规格适配器（100W USB-C PD 或 DC口）',
  },
  {
    id: 2,
    title: '观察关机时机',
    icon: '⏱️',
    tag: '观察',
    time: '2分钟',
    instruction: [
      '现在按电源键开机，用手机计时：',
      '',
      '❶ 按下电源键的那一刻 → 开始计时',
      '❷ 电脑彻底灭掉 → 停止计时',
      '❸ 同时观察：',
      '   • 屏幕有没有亮过？',
      '   • 风扇有没有转过？',
      '   • 有没有听到"嘎达"声？',
    ],
    ask: '从按下电源到灭掉，大约几秒？',
    yes: { text: '< 10秒', next: 3, msg: '极短时间关机 → 硬件级问题（电源键/短路/内存）。' },
    no: { text: '10秒~1分钟', next: 4, msg: '中等时间 → 可能是内存/BIOS/供电问题。' },
    maybe: { text: '> 1分钟 / 能看到画面', next: 7, msg: '能到系统层面 → 可能是驱动/散热/软件问题。' },
  },
  {
    id: 3,
    title: '检查开机按键',
    icon: '🔘',
    tag: '零成本',
    time: '1分钟',
    instruction: [
      '开关短路一次=开机，再次短路=关机',
      '如果按钮持续短路 → 开了又关',
      '',
      '❶ 按开机键时，注意手感是否粘滞/不回弹',
      '❷ 尝试快速轻按（不要长按）',
      '❸ 观察按键是否有异物/卡住',
      '❹ 如有压缩空气，对准按键周围吹',
    ],
    ask: '按键手感正常吗？快速轻按后有改善吗？',
    yes: { text: '按键正常，没改善', next: 4, msg: '排除按键问题，进入拆机排查。' },
    no: { text: '按键确实有问题', next: 'done', msg: '🔧 按键故障确认。可自行更换按键开关或送修。' },
  },
  {
    id: 4,
    title: '重插内存条',
    icon: '🧩',
    tag: '需拆机',
    time: '10分钟',
    instruction: [
      '⚠️ 拆机前：关机 → 拔电源 → 触摸金属物释放静电',
      '',
      '❶ 拧开后盖螺丝（十字PH1螺丝刀）',
      '❷ 找到内存条插槽',
      '❸ 扣开两侧卡扣，取出内存条',
      '❹ 用橡皮擦轻擦金手指（金色触点）',
      '❺ 清理插槽灰尘',
      '❻ 重新插入，听到"咔嗒"声',
      '❼ 如有两条：先只插一条测试，再换另一条',
    ],
    ask: '重插内存后能正常开机了吗？',
    yes: { text: '能开机了！', next: 'done', msg: '🎉 内存接触不良已修复！建议插紧并检查卡扣。' },
    no: { text: '还是不行', next: 5, msg: '排除内存接触问题，继续检查电池和硬盘。' },
    maybe: { text: '单条A能开/单条B不行', next: 'done', msg: '🔍 内存条B故障确认！需更换同规格DDR5内存条。' },
    photo: true,
    tip: '拍一张内存条金手指的照片，看是否有明显氧化/腐蚀',
  },
  {
    id: 5,
    title: '检查电池 + 仅适配器供电',
    icon: '🔋',
    tag: '需拆机',
    time: '5分钟',
    instruction: [
      '❶ 打开后盖，找到电池排线接口',
      '❷ 拔掉电池排线',
      '❸ 仅用电源适配器，按电源键开机',
      '',
      '无界14+已知问题：',
      '• 电池显示0%或255%后无法开机',
      '• 电池管理IC故障导致按开机键无反应',
    ],
    ask: '拔掉电池后，仅用适配器能开机吗？',
    yes: { text: '能开机！', next: 'done', msg: '🔋 电池故障确认！需更换电池。适配器供电可临时使用。' },
    no: { text: '还是不行', next: 6, msg: '排除电池，检查硬盘和主板。' },
    photo: true,
  },
  {
    id: 6,
    title: '拔硬盘 + CMOS放电',
    icon: '💾',
    tag: '需拆机',
    time: '10分钟',
    instruction: [
      '步骤A - 拔SSD：',
      '❶ 找到M.2 SSD，拧开固定螺丝',
      '❷ 拔出SSD',
      '❸ 开机按F2尝试进BIOS',
      '',
      '步骤B - CMOS放电（如连BIOS都进不了）：',
      '❹ 找到主板纽扣电池(CR2032)',
      '❺ 取出，等30秒',
      '❻ 装回，开机',
    ],
    ask: '拔SSD后能进BIOS吗？或CMOS放电后有改善吗？',
    yes: { text: '能进BIOS了', next: 8, msg: '进BIOS了！可能是SSD故障或系统损坏。' },
    no: { text: '什么都试了还是不行', next: 9, msg: '所有排查已完成，指向主板级故障。' },
    maybe: { text: 'CMOS放电后能开了', next: 'done', msg: '🎉 BIOS设置异常已修复！建议升级BIOS防止复发。' },
    warning: '纽扣电池2-3年可能耗尽（正常3V，低于2V需更换）',
  },
  {
    id: 7,
    title: '散热 + 驱动检查',
    icon: '🌡️',
    tag: '需拆机/需进系统',
    time: '15~30分钟',
    instruction: [
      '散热方向：',
      '❶ 出风口是否有灰堵住？',
      '❷ 风扇是否正常转动？',
      '❸ 如有条件：拆散热，清灰换硅脂',
      '',
      '驱动方向（如能进系统）：',
      '❹ 强制关机3次 → 进安全模式',
      '❺ 安全模式下稳定吗？',
      '❻ 稳定 → 驱动冲突，运行DDU卸载AMD显卡驱动',
      '❼ 重装机械革命官网OEM驱动（不要用AMD最新驱动！）',
    ],
    ask: '清灰或修复驱动后解决了吗？',
    yes: { text: '解决了！', next: 'done', msg: '🎉 问题已修复！散热问题建议定期清灰。驱动问题建议锁定OEM版本。' },
    no: { text: '还有问题', next: 8, msg: '继续BIOS层面排查。' },
    tip: '无界14+的AMD 780M掉驱动是已知通病。用OEM驱动而非AMD官方最新。',
    photo: true,
  },
  {
    id: 8,
    title: '升级BIOS（关键！）',
    icon: '⬆️',
    tag: '需进系统',
    time: '10分钟',
    instruction: [
      '无界14+ 出厂BIOS有多个Bug！',
      '升级可能一次性解决所有问题',
      '',
      '❶ 升级到 T140_PHX_13 或更新版本',
      '❷ 下载：机械革命官网驱动页 或 百度网盘搜"无界14+ bios"',
      '❸ 下载exe，双击运行即可升级',
      '',
      '升级后还可调整：',
      '• 内存频率（4800MHz ↔ 5600MHz）',
      '• 虚拟显存（512MB → 2G/4G）',
      '• 检查内存频率：如设为5600不稳定 → 改回4800',
    ],
    ask: '能升级BIOS吗？升级后有改善吗？',
    yes: { text: '升级后解决了', next: 'done', msg: '🎉 BIOS Bug修复成功！建议同时调整内存频率到4800MHz。' },
    no: { text: '无法升级 / 升级后仍有问题', next: 9, msg: '所有软件层面已排除，进入最终诊断。' },
    warning: '⚡ 升级过程中绝对不能断电/关机！确保电源稳定！',
  },
  {
    id: 9,
    title: '最终诊断 · 送修判断',
    icon: '🔍',
    tag: '最终',
    time: '5分钟',
    instruction: [
      '用手机闪光灯仔细检查主板：',
      '',
      '❶ 有没有烧焦/发黑痕迹？',
      '❷ 有没有鼓包的电容？（顶部应平整）',
      '❸ 有没有松动的螺丝掉在主板上？（会短路！）',
      '❹ 有没有液体残留/腐蚀痕迹？',
      '',
      '以上检查完毕后，综合判断：',
    ],
    ask: '有发现明显的硬件损伤吗？',
    yes: { text: '发现了损伤', next: 'done', msg: '📸 拍照记录损伤位置。需要主板级维修或更换主板。联系售后400-898-1777。' },
    no: { text: '看起来正常', next: 'done', msg: '🏥 建议送修。可能是BGA焊点虚焊、内部IC故障等不可见问题。售后电话：400-898-1777，京东延保可走京东售后。' },
    photo: true,
  },
]

const SPECS = [
  { label: 'CPU', value: 'Ryzen 7 7840HS (8C/16T, 5.1GHz)' },
  { label: 'GPU', value: 'Radeon 780M (RDNA3, 12CU)' },
  { label: '内存', value: '双DDR5插槽, 出厂4800MHz' },
  { label: '存储', value: '双M.2 2280 PCIe 4.0' },
  { label: '屏幕', value: '14" 2880×1800 120Hz' },
  { label: '进BIOS', value: '开机按 F2' },
  { label: '启动菜单', value: '开机按 F7' },
  { label: '性能模式', value: 'Fn+F1 (节能/均衡/性能)' },
  { label: '售后电话', value: '400-898-1777' },
]

const KNOWN_ISSUES = [
  { title: 'BIOS旧版Bug', desc: '蓝屏/重启/内存异常 → 升级T140_PHX_13+', color: 'red' },
  { title: '780M掉驱动', desc: '黑屏卡死 → 用OEM驱动非AMD官方', color: 'red' },
  { title: '内存频率', desc: '出厂4800MHz避蓝屏，调高可能不稳', color: 'amber' },
  { title: '随机重启+嘎达声', desc: '主板供电回路，可能需换主板', color: 'amber' },
  { title: '电池0%/255%', desc: '电池IC故障，释放静电或送修', color: 'amber' },
  { title: 'S0睡眠耗电', desc: '合盖耗电 → BIOS改S3', color: 'gray' },
]

// ──────────────────── Helpers ────────────────────

function timeStr(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}秒`
  return `${Math.floor(s/60)}分${s%60}秒`
}

function uid(): string { return Date.now().toString(36) + Math.random().toString(36).slice(2,6) }

// ──────────────────── Main Component ────────────────────

export default function Home() {
  const [view, setView] = useState<View>('wizard')
  const [currentNode, setCurrentNode] = useState(0)
  const [steps, setSteps] = useState<Record<number, StepState>>({})
  const [log, setLog] = useState<LogEntry[]>([])
  const [sessionStart] = useState(Date.now())
  const [noteText, setNoteText] = useState('')
  const [isDone, setIsDone] = useState(false)
  const [doneMsg, setDoneMsg] = useState('')
  const [timer, setTimer] = useState(0)
  const logEndRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load state from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('mechrevo_diag')
      if (saved) {
        const d = JSON.parse(saved)
        if (d.steps) setSteps(d.steps)
        if (d.log) setLog(d.log)
        if (d.currentNode !== undefined) setCurrentNode(d.currentNode)
        if (d.isDone) { setIsDone(true); setDoneMsg(d.doneMsg || '') }
      }
    } catch {}
  }, [])

  // Save state
  useEffect(() => {
    try {
      localStorage.setItem('mechrevo_diag', JSON.stringify({ steps, log, currentNode, isDone, doneMsg }))
    } catch {}
  }, [steps, log, currentNode, isDone, doneMsg])

  // Timer
  useEffect(() => {
    if (!isDone && steps[currentNode]?.status === 'active') {
      timerRef.current = setInterval(() => {
        setTimer(Date.now() - (steps[currentNode]?.startTime || Date.now()))
      }, 1000)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [currentNode, isDone, steps])

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [log])

  const addLog = useCallback((type: LogEntry['type'], text: string, step?: number, photo?: string) => {
    setLog(prev => [...prev, { id: uid(), time: timeStr(), type, text, step, photo }])
  }, [])

  const node = DIAG_TREE[currentNode]

  // Start working on current node
  const activateStep = useCallback(() => {
    if (!steps[currentNode]?.startTime) {
      setSteps(prev => ({
        ...prev,
        [currentNode]: { status: 'active', notes: '', startTime: Date.now() }
      }))
      addLog('system', `开始: ${node.title}`, currentNode)
    }
  }, [currentNode, steps, addLog, node])

  useEffect(() => { activateStep() }, [currentNode, activateStep])

  const handleAnswer = (choice: 'yes' | 'no' | 'maybe') => {
    const option = node[choice]
    if (!option) return

    const elapsed = Date.now() - (steps[currentNode]?.startTime || Date.now())
    setSteps(prev => ({
      ...prev,
      [currentNode]: {
        ...prev[currentNode],
        status: 'done',
        result: choice === 'yes' ? 'success' : choice === 'no' ? 'fail' : 'unclear',
        elapsed,
      }
    }))

    addLog('finding', `${node.title} → ${option.text}`, currentNode)
    addLog('system', option.msg, currentNode)

    if (option.next === 'done') {
      setIsDone(true)
      setDoneMsg(option.msg)
    } else {
      setCurrentNode(option.next)
      setTimer(0)
    }
  }

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      addLog('photo', `${node.title} - 拍照记录`, currentNode, dataUrl)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const addNote = () => {
    if (!noteText.trim()) return
    addLog('note', noteText.trim(), currentNode)
    setSteps(prev => ({
      ...prev,
      [currentNode]: { ...prev[currentNode], notes: (prev[currentNode]?.notes || '') + '\n' + noteText.trim() }
    }))
    setNoteText('')
  }

  const resetAll = () => {
    setSteps({})
    setLog([])
    setCurrentNode(0)
    setIsDone(false)
    setDoneMsg('')
    setTimer(0)
    localStorage.removeItem('mechrevo_diag')
  }

  const totalElapsed = Date.now() - sessionStart

  // ──────────────────── Render ────────────────────

  return (
    <main className="mx-auto max-w-lg min-h-screen pb-20 bg-[#0a0a0f]">
      {/* Hidden file input for camera */}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhoto} />

      {/* Header */}
      <div className="sticky top-0 z-30 bg-[#0a0a0f]/95 backdrop-blur-md border-b border-gray-800/50">
        <div className="flex items-center gap-3 px-4 pt-3 pb-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-base">🔧</div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold truncate">机械革命14+ 诊断中枢</h1>
            <p className="text-[10px] text-gray-500">
              {isDone ? '✅ 诊断完成' : `步骤 ${currentNode + 1}/${DIAG_TREE.length}`}
              {' · '}总耗时 {fmtElapsed(totalElapsed)}
            </p>
          </div>
          {!isDone && (
            <div className="text-right">
              <p className="text-xs text-indigo-400 font-mono">{fmtElapsed(timer)}</p>
              <p className="text-[10px] text-gray-600">本步计时</p>
            </div>
          )}
        </div>

        {/* Progress */}
        <div className="flex gap-0.5 px-4 pb-1">
          {DIAG_TREE.map((n, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-all ${
                steps[i]?.status === 'done'
                  ? steps[i]?.result === 'success' ? 'bg-green-500' : steps[i]?.result === 'fail' ? 'bg-red-500' : 'bg-amber-500'
                  : i === currentNode ? 'bg-indigo-500 animate-pulse' : 'bg-gray-800'
              }`}
            />
          ))}
        </div>

        {/* Nav */}
        <div className="flex border-t border-gray-800/50">
          {([
            ['wizard', '🎯', '诊断'],
            ['log', '📋', '日志'],
            ['camera', '📸', '拍照'],
            ['specs', '📊', '规格'],
            ['report', '📄', '报告'],
          ] as [View, string, string][]).map(([v, icon, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex-1 py-2 text-center text-xs transition-all ${
                view === v ? 'text-indigo-400 bg-indigo-500/5 border-b-2 border-indigo-500' : 'text-gray-500'
              }`}
            >
              {icon} {label}
              {v === 'log' && log.length > 0 && (
                <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] text-white">
                  {log.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-4">
        {/* ────── Wizard View ────── */}
        {view === 'wizard' && !isDone && node && (
          <div className="space-y-4 fade-in">
            {/* Step header */}
            <div className="rounded-2xl border border-indigo-500/30 bg-indigo-950/20 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">{node.icon}</span>
                <div>
                  <h2 className="text-lg font-bold">{node.title}</h2>
                  <div className="flex gap-2 mt-0.5">
                    <span className="inline-flex items-center rounded-full bg-gray-800 px-2 py-0.5 text-[10px] text-gray-400">{node.tag}</span>
                    <span className="inline-flex items-center rounded-full bg-gray-800 px-2 py-0.5 text-[10px] text-gray-400">⏱ {node.time}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Instructions */}
            <div className="rounded-2xl border border-gray-800 bg-[#12121a] p-4 space-y-1.5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">操作步骤</p>
              {node.instruction.map((line, i) => (
                <p key={i} className={`text-sm ${
                  line === '' ? 'h-2' :
                  line.startsWith('❶') || line.startsWith('❷') || line.startsWith('❸') || line.startsWith('❹') || line.startsWith('❺') || line.startsWith('❻') || line.startsWith('❼')
                    ? 'text-white' : line.startsWith('   ') ? 'text-gray-400 pl-4' : 'text-gray-300'
                }`}>{line}</p>
              ))}
            </div>

            {/* Tip / Warning */}
            {node.tip && (
              <div className="rounded-xl bg-green-950/30 border border-green-500/20 p-3">
                <p className="text-sm text-green-300">💡 {node.tip}</p>
              </div>
            )}
            {node.warning && (
              <div className="rounded-xl bg-amber-950/30 border border-amber-500/20 p-3">
                <p className="text-sm text-amber-300">⚠️ {node.warning}</p>
              </div>
            )}

            {/* Photo button */}
            {node.photo && (
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full rounded-xl border border-dashed border-gray-600 bg-gray-900/50 p-3 text-sm text-gray-400 active:bg-gray-800 transition-all"
              >
                📸 拍照记录（可选）
              </button>
            )}

            {/* Note input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addNote()}
                placeholder="记录观察到的现象..."
                className="flex-1 rounded-xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:border-indigo-500 focus:outline-none"
              />
              <button onClick={addNote} className="rounded-xl bg-gray-800 px-3 text-sm text-gray-300 active:bg-gray-700">
                记录
              </button>
            </div>

            {/* Question + Answers */}
            <div className="rounded-2xl border border-indigo-500/20 bg-[#12121a] p-4 space-y-3">
              <p className="text-sm font-semibold text-indigo-300">{node.ask}</p>
              <div className="space-y-2">
                <button
                  onClick={() => handleAnswer('yes')}
                  className="w-full rounded-xl bg-green-600/20 border border-green-500/30 p-3 text-left text-sm text-green-300 font-medium active:bg-green-600/30 transition-all"
                >
                  ✅ {node.yes.text}
                </button>
                <button
                  onClick={() => handleAnswer('no')}
                  className="w-full rounded-xl bg-red-600/20 border border-red-500/30 p-3 text-left text-sm text-red-300 font-medium active:bg-red-600/30 transition-all"
                >
                  ❌ {node.no.text}
                </button>
                {node.maybe && (
                  <button
                    onClick={() => handleAnswer('maybe')}
                    className="w-full rounded-xl bg-amber-600/20 border border-amber-500/30 p-3 text-left text-sm text-amber-300 font-medium active:bg-amber-600/30 transition-all"
                  >
                    🤔 {node.maybe.text}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ────── Done View ────── */}
        {view === 'wizard' && isDone && (
          <div className="space-y-4 fade-in">
            <div className="rounded-2xl border border-green-500/30 bg-green-950/20 p-6 text-center">
              <p className="text-4xl mb-3">🏁</p>
              <h2 className="text-xl font-bold text-green-300 mb-2">诊断完成</h2>
              <p className="text-sm text-gray-300">{doneMsg}</p>
              <p className="text-xs text-gray-500 mt-3">
                总耗时 {fmtElapsed(totalElapsed)} · {Object.values(steps).filter(s => s.status === 'done').length} 步完成
              </p>
            </div>

            <div className="rounded-2xl border border-gray-800 bg-[#12121a] p-4 space-y-2">
              <p className="text-sm font-semibold text-white mb-2">排查路径回顾</p>
              {Object.entries(steps)
                .filter(([, s]) => s.status === 'done')
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([id, s]) => {
                  const n = DIAG_TREE[Number(id)]
                  return (
                    <div key={id} className="flex items-center gap-2 text-sm">
                      <span className={`h-2 w-2 rounded-full ${
                        s.result === 'success' ? 'bg-green-500' : s.result === 'fail' ? 'bg-red-500' : 'bg-amber-500'
                      }`} />
                      <span className="text-gray-300">{n.icon} {n.title}</span>
                      <span className="text-gray-600 ml-auto">{s.elapsed ? fmtElapsed(s.elapsed) : ''}</span>
                    </div>
                  )
                })}
            </div>

            <button onClick={resetAll} className="w-full rounded-xl border border-gray-700 bg-gray-900 p-3 text-sm text-gray-400 active:bg-gray-800">
              🔄 重新开始诊断
            </button>
          </div>
        )}

        {/* ────── Log View ────── */}
        {view === 'log' && (
          <div className="space-y-2 fade-in">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500">{log.length} 条记录</p>
              {log.length > 0 && (
                <button onClick={() => { setLog([]); }} className="text-xs text-red-400">清空</button>
              )}
            </div>
            {log.length === 0 && (
              <div className="text-center py-12 text-gray-600 text-sm">暂无记录，开始诊断后自动记录</div>
            )}
            {log.map(entry => (
              <div key={entry.id} className={`rounded-xl border p-3 text-sm ${
                entry.type === 'system' ? 'border-indigo-500/20 bg-indigo-950/10' :
                entry.type === 'finding' ? 'border-green-500/20 bg-green-950/10' :
                entry.type === 'photo' ? 'border-purple-500/20 bg-purple-950/10' :
                entry.type === 'note' ? 'border-amber-500/20 bg-amber-950/10' :
                'border-gray-800 bg-[#12121a]'
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] text-gray-500 font-mono">{entry.time}</span>
                  <span className="text-[10px] rounded px-1.5 py-0.5 bg-gray-800 text-gray-400">
                    {entry.type === 'system' ? '系统' : entry.type === 'finding' ? '发现' : entry.type === 'photo' ? '照片' : entry.type === 'note' ? '笔记' : '操作'}
                  </span>
                  {entry.step !== undefined && (
                    <span className="text-[10px] text-gray-600">步骤{entry.step + 1}</span>
                  )}
                </div>
                <p className="text-gray-300">{entry.text}</p>
                {entry.photo && (
                  <img src={entry.photo} alt="诊断照片" className="mt-2 rounded-lg max-h-48 object-cover" />
                )}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}

        {/* ────── Camera View ────── */}
        {view === 'camera' && (
          <div className="space-y-4 fade-in text-center">
            <div className="rounded-2xl border border-purple-500/20 bg-purple-950/20 p-6">
              <p className="text-4xl mb-3">📸</p>
              <h2 className="text-lg font-bold text-purple-300 mb-2">拍照记录</h2>
              <p className="text-sm text-gray-400 mb-4">用手机摄像头拍摄主板、内存、电池等部件，保存诊断证据</p>
              <button
                onClick={() => fileRef.current?.click()}
                className="rounded-xl bg-purple-600 px-8 py-3 text-sm font-semibold text-white active:bg-purple-500 transition-all"
              >
                打开摄像头拍照
              </button>
            </div>

            <div className="text-left space-y-2">
              <p className="text-xs text-gray-500">拍照建议：</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['🔌', '电源接口'],
                  ['🧩', '内存金手指'],
                  ['🔋', '电池排线'],
                  ['🔍', '主板全景'],
                  ['💾', 'SSD插槽'],
                  ['🌡️', '散热铜管'],
                ].map(([icon, label]) => (
                  <button
                    key={label}
                    onClick={() => fileRef.current?.click()}
                    className="rounded-xl border border-gray-800 bg-[#12121a] p-3 text-sm text-gray-300 active:bg-gray-800"
                  >
                    {icon} {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Show captured photos */}
            {log.filter(e => e.photo).length > 0 && (
              <div className="text-left">
                <p className="text-xs text-gray-500 mb-2">已拍摄 ({log.filter(e => e.photo).length})</p>
                <div className="grid grid-cols-2 gap-2">
                  {log.filter(e => e.photo).map(e => (
                    <img key={e.id} src={e.photo} alt="" className="rounded-xl object-cover h-32 w-full" />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ────── Specs View ────── */}
        {view === 'specs' && (
          <div className="space-y-3 fade-in">
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-950/20 p-4">
              <h2 className="font-semibold text-cyan-300">📊 无界14+ 硬件规格</h2>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-[#12121a] overflow-hidden">
              {SPECS.map((s, i) => (
                <div key={i} className={`flex px-4 py-2.5 ${i > 0 ? 'border-t border-gray-800' : ''}`}>
                  <span className="text-xs text-gray-500 w-16 flex-shrink-0">{s.label}</span>
                  <span className="text-xs font-medium text-white">{s.value}</span>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-gray-800 bg-[#12121a] p-4 space-y-2">
              <h3 className="text-sm font-semibold text-white">🚨 已知通病</h3>
              {KNOWN_ISSUES.map((issue, i) => (
                <div key={i} className={`rounded-xl border p-3 ${
                  issue.color === 'red' ? 'border-red-500/10 bg-red-950/20' :
                  issue.color === 'amber' ? 'border-amber-500/10 bg-amber-950/20' :
                  'border-gray-700 bg-gray-800/50'
                }`}>
                  <p className={`text-xs font-medium ${
                    issue.color === 'red' ? 'text-red-300' : issue.color === 'amber' ? 'text-amber-300' : 'text-gray-300'
                  }`}>{issue.title}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{issue.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ────── Report View ────── */}
        {view === 'report' && (
          <div className="space-y-4 fade-in">
            <div className="rounded-2xl border border-gray-800 bg-[#12121a] p-4">
              <h2 className="text-sm font-bold text-white mb-3">📄 诊断报告</h2>
              <div className="space-y-1 text-xs">
                <p className="text-gray-400">设备: <span className="text-white">机械革命 无界14+ (7840HS)</span></p>
                <p className="text-gray-400">日期: <span className="text-white">{new Date().toLocaleDateString('zh-CN')}</span></p>
                <p className="text-gray-400">总耗时: <span className="text-white">{fmtElapsed(totalElapsed)}</span></p>
                <p className="text-gray-400">状态: <span className={isDone ? 'text-green-400' : 'text-amber-400'}>{isDone ? '已完成' : '进行中'}</span></p>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-800 bg-[#12121a] p-4">
              <h3 className="text-xs font-bold text-white mb-2">排查步骤</h3>
              {DIAG_TREE.map((n, i) => {
                const s = steps[i]
                return (
                  <div key={i} className="flex items-center gap-2 py-1.5 border-b border-gray-800 last:border-0">
                    <span className={`text-xs w-4 ${
                      !s ? 'text-gray-700' :
                      s.result === 'success' ? 'text-green-400' :
                      s.result === 'fail' ? 'text-red-400' :
                      s.result === 'unclear' ? 'text-amber-400' : 'text-gray-500'
                    }`}>
                      {!s ? '·' : s.result === 'success' ? '✓' : s.result === 'fail' ? '✗' : '?'}
                    </span>
                    <span className={`text-xs flex-1 ${!s ? 'text-gray-700' : 'text-gray-300'}`}>{n.icon} {n.title}</span>
                    <span className="text-[10px] text-gray-600">{s?.elapsed ? fmtElapsed(s.elapsed) : '--'}</span>
                  </div>
                )
              })}
            </div>

            {log.filter(e => e.type === 'finding' || e.type === 'note').length > 0 && (
              <div className="rounded-2xl border border-gray-800 bg-[#12121a] p-4">
                <h3 className="text-xs font-bold text-white mb-2">关键发现</h3>
                {log.filter(e => e.type === 'finding' || e.type === 'note').map(e => (
                  <p key={e.id} className="text-xs text-gray-400 py-1 border-b border-gray-800 last:border-0">
                    <span className="text-gray-600 font-mono">{e.time}</span> {e.text}
                  </p>
                ))}
              </div>
            )}

            {log.filter(e => e.photo).length > 0 && (
              <div className="rounded-2xl border border-gray-800 bg-[#12121a] p-4">
                <h3 className="text-xs font-bold text-white mb-2">照片证据 ({log.filter(e => e.photo).length})</h3>
                <div className="grid grid-cols-2 gap-2">
                  {log.filter(e => e.photo).map(e => (
                    <img key={e.id} src={e.photo} alt="" className="rounded-lg object-cover h-24 w-full" />
                  ))}
                </div>
              </div>
            )}

            {isDone && doneMsg && (
              <div className="rounded-2xl border border-green-500/20 bg-green-950/20 p-4">
                <h3 className="text-xs font-bold text-green-300 mb-1">最终结论</h3>
                <p className="text-sm text-gray-300">{doneMsg}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
