import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import { Board } from '../src/components/Board'
import { CaptureRevealAnimation } from '../src/components/CaptureRevealAnimation'
import { effectDurations, resolveBoardEffect } from '../src/effectPresentation'
import type { PublicGameState } from '../src/game'

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState({}, '', '/local?seed=42')
  })

  it('offers local and online play from the home page', () => {
    window.history.replaceState({}, '', '/')
    render(<App initialPath={window.location.pathname} />)
    expect(screen.getByRole('link', { name: /本地对战/ })).toHaveAttribute('href', '/local')
    expect(screen.getByRole('link', { name: /联机对战/ })).toHaveAttribute('href', '/online')
  })

  it('renders the online lobby with a remembered required nickname and room-code entry', () => {
    localStorage.setItem('anqi-player-nickname', '旧昵称')
    window.history.replaceState({}, '', '/online')
    render(<App initialPath={window.location.pathname} />)
    expect(screen.getByRole('textbox', { name: '你的昵称' })).toHaveValue('旧昵称')
    expect(screen.getByRole('button', { name: '创建房间' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '四位房间号' })).toBeInTheDocument()
    const joinForm = screen.getByRole('button', { name: '加入房间' }).closest('form')!
    fireEvent.change(screen.getByRole('textbox', { name: '你的昵称' }), { target: { value: '' } })
    fireEvent.submit(joinForm)
    expect(screen.getByRole('status')).toHaveTextContent('请输入 1 至 12 个字符的昵称')
  })

  it('renders a masked, playable initial board', () => {
    render(<App initialPath={window.location.pathname} />)
    const board = screen.getByTestId('xiangqi-board')
    const hidden = within(board).getAllByRole('button', { name: /^暗棋/ })
    expect(hidden).toHaveLength(30)
    expect(within(board).getByRole('button', { name: '红方帥' })).toBeInTheDocument()
    expect(within(board).getByRole('button', { name: '黑方將' })).toBeInTheDocument()
    for (const piece of hidden) {
      expect(piece).toHaveAttribute('data-revealed', 'false')
      expect(piece.querySelector('img')).toBeNull()
      expect(piece.getAttribute('aria-label')).not.toMatch(/帥|仕|相|馬|車|炮|兵|將|士|象|砲|卒/)
    }
    expect(screen.getByText('红方行棋')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '黑方吃子' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '红方吃子' })).toBeInTheDocument()
    expect(screen.queryByText(/0 枚/)).not.toBeInTheDocument()
    expect(document.querySelector('.board-compass')).not.toBeInTheDocument()
    expect(screen.queryByText('暗棋本地对战版')).not.toBeInTheDocument()
    expect(screen.queryByText('同屏双人 · 无需联网')).not.toBeInTheDocument()
    expect(document.querySelectorAll('.sidebar-info-stack .info-card')).toHaveLength(3)
    expect(screen.getByRole('button', { name: '新的一局' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /悔棋/ })).not.toBeInTheDocument()
  })

  it('toggles move hints without disabling the selected legal move', async () => {
    const user = userEvent.setup()
    render(<App initialPath={window.location.pathname} />)
    const toggle = screen.getByRole('button', { name: '提示落点' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: '暗棋，1路第10行' }))
    expect(document.querySelectorAll('.move-hint').length).toBeGreaterThan(0)
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(document.querySelector('.move-hint')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '1路第9行，可落子' }))
    expect(screen.getByText('黑方行棋')).toBeInTheDocument()
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('cancels the current selection when the selected piece is double-clicked', async () => {
    const user = userEvent.setup()
    render(<App initialPath={window.location.pathname} />)
    const piece = screen.getByRole('button', { name: '暗棋，1路第10行' })

    await user.click(piece)
    expect(piece).toHaveClass('is-selected')
    await user.dblClick(piece)
    expect(piece).not.toHaveClass('is-selected')
    expect(screen.getByText('红方行棋')).toBeInTheDocument()
  })

  it('selects, moves and reveals a dark piece without previewing its identity', async () => {
    const user = userEvent.setup()
    render(<App initialPath={window.location.pathname} />)
    const piece = screen.getByRole('button', { name: '暗棋，1路第10行' })
    await user.click(piece)

    const destination = screen.getByRole('button', { name: '1路第9行，可落子' })
    await user.click(destination)
    expect(screen.getByText('黑方行棋')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^暗棋/ })).toHaveLength(29)
    expect(document.querySelectorAll('[data-revealed="true"]')).toHaveLength(3)
  })

  it('opens and closes the rules', async () => {
    const user = userEvent.setup()
    render(<App initialPath={window.location.pathname} />)

    await user.click(screen.getByRole('button', { name: '玩法' }))
    expect(screen.getByRole('dialog', { name: '暗棋规则' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '明白了' }))
    expect(screen.queryByRole('dialog', { name: '暗棋规则' })).not.toBeInTheDocument()
  })

  it('confirms and starts a new game from an active position', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App initialPath={window.location.pathname} />)
    await user.click(screen.getByRole('button', { name: '暗棋，1路第10行' }))
    await user.click(screen.getByRole('button', { name: '1路第9行，可落子' }))
    await user.click(screen.getByRole('button', { name: '新的一局' }))

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('新的一局'))
    expect(screen.getAllByRole('button', { name: /^暗棋/ })).toHaveLength(30)
    expect(screen.getByText('红方行棋')).toBeInTheDocument()
  })

  it('flies a captured dark piece face-down, then reveals it with the capture-tray style', async () => {
    const user = userEvent.setup()
    render(<App initialPath={window.location.pathname} />)

    await user.click(screen.getByRole('button', { name: '暗棋，1路第10行' }))
    await user.click(screen.getByRole('button', { name: '暗棋，2路第10行' }))

    const animation = screen.getByTestId('capture-reveal-animation')
    expect(animation).toBeInTheDocument()
    expect(animation.querySelector('.capture-reveal-back')).toBeInTheDocument()
    expect(animation.querySelector('.dark-piece-back-ring')).toBeInTheDocument()
    expect(animation.querySelector('.dark-piece-back-mark')).toBeInTheDocument()
    expect(animation.querySelector('.capture-reveal-front.captured-token')).toBeInTheDocument()
    expect(animation.querySelector('.capture-reveal-front i')).toHaveTextContent('暗')
    expect(animation.querySelector('.capture-reveal-front img')).not.toBeInTheDocument()
    const redTray = screen.getByRole('region', { name: '红方吃子' })
    expect(redTray.querySelector('.captured-token.is-pending')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^暗棋/ })).toHaveLength(28)
  })

  it('flies an already revealed capture face-up before settling into the capture-tray style', () => {
    render(
      <>
        <span data-cell="0,0" />
        <span data-captured-piece="revealed-target" />
        <CaptureRevealAnimation
          capture={{
            key: 1,
            pieceId: 'revealed-target',
            position: { x: 0, y: 0 },
            identity: { camp: 'black', kind: 'horse' },
            capturedBy: 'red',
            wasRevealed: true,
          }}
        />
      </>,
    )

    const animation = screen.getByTestId('capture-reveal-animation')
    expect(animation.querySelector('.is-revealed-capture')).toBeInTheDocument()
    expect(animation.querySelector('.capture-reveal-board-front img')).toBeInTheDocument()
    expect(animation.querySelector('.capture-reveal-front.captured-token')).toHaveTextContent('馬')
    expect(animation.querySelector('.capture-reveal-front i')).not.toBeInTheDocument()
    expect(animation.querySelector('.capture-reveal-back')).not.toBeInTheDocument()
  })

  it('renders capture, check and checkmate calligraphy overlays', () => {
    const publicGame: PublicGameState = {
      pieces: [],
      captured: [],
      turn: 'red',
      status: { phase: 'playing', checkedCamps: ['red'] },
      moveNumber: 3,
      canUndo: false,
    }
    const { rerender } = render(
      <Board game={publicGame} legalMoves={[]} effect="check" onCellClick={() => undefined} />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('将')
    rerender(
      <Board game={publicGame} legalMoves={[]} effect="checkmate" onCellClick={() => undefined} />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('绝杀')
    rerender(
      <Board game={publicGame} legalMoves={[]} effect="capture" onCellClick={() => undefined} />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('吃')
    rerender(
      <Board game={publicGame} legalMoves={[]} effect="battle" onCellClick={() => undefined} />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('开战')
    expect(effectDurations).toEqual({ battle: 1550, capture: 1300, check: 1550, checkmate: 2000 })
    expect(resolveBoardEffect(
      { phase: 'playing', checkedCamps: ['black'] },
      true,
    )).toBe('check')
    expect(resolveBoardEffect(
      { phase: 'won', winner: 'red', reason: 'checkmate', checkedCamps: ['black'] },
      true,
    )).toBe('checkmate')
  })

  it('rotates logical positions for a black-side perspective while keeping labels upright', () => {
    const publicGame: PublicGameState = {
      pieces: [{
        id: 'black-general',
        position: { x: 4, y: 0 },
        revealed: true,
        identity: { camp: 'black', kind: 'general' },
      }],
      captured: [],
      turn: 'red',
      status: { phase: 'playing', checkedCamps: [] },
      moveNumber: 0,
      canUndo: false,
    }
    const { rerender } = render(
      <Board game={publicGame} legalMoves={[]} perspective="red" onCellClick={() => undefined} />,
    )
    const general = screen.getByRole('button', { name: '黑方將' })
    const redTop = general.style.top
    rerender(
      <Board game={publicGame} legalMoves={[]} perspective="black" onCellClick={() => undefined} />,
    )
    expect(general.style.top).not.toBe(redTop)
    expect(Number.parseFloat(general.style.top)).toBeGreaterThan(90)
  })

  it('renders a capture hint above its target piece and shows the self-check warning', () => {
    const publicGame: PublicGameState = {
      pieces: [{
        id: 'target',
        position: { x: 0, y: 0 },
        revealed: false,
        cover: { camp: 'black', kind: 'chariot' },
      }],
      captured: [],
      turn: 'red',
      status: { phase: 'playing', checkedCamps: ['red'] },
      lastMove: {
        from: { x: 0, y: 1 },
        to: { x: 0, y: 0 },
        moverCamp: 'black',
        pieceId: 'target',
      },
      moveNumber: 3,
      canUndo: false,
    }
    const { rerender } = render(
      <Board
        game={publicGame}
        legalMoves={[{ x: 0, y: 0 }]}
        warning="移动将会送将"
        onCellClick={() => undefined}
      />,
    )
    const captureCell = document.querySelector('[data-cell="0,0"]')
    expect(captureCell).toHaveClass('is-capture')
    expect(captureCell?.querySelector('.move-hint.capture')).toBeInTheDocument()
    expect(captureCell?.querySelector('.last-move-marker')).not.toBeInTheDocument()
    expect(document.querySelector('[data-piece-id="target"]')).toHaveAttribute('data-last-moved', 'true')
    expect(document.querySelector('[data-piece-id="target"] .piece-last-move-marker')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('移动将会送将')
    expect(screen.queryByText('不可落子')).not.toBeInTheDocument()

    rerender(
      <Board
        game={publicGame}
        legalMoves={[{ x: 0, y: 0 }]}
        showMoveHints={false}
        onCellClick={() => undefined}
      />,
    )
    expect(document.querySelector('[data-cell="0,0"]')).not.toHaveClass('is-capture')
    expect(document.querySelector('.move-hint')).not.toBeInTheDocument()
    expect(document.querySelector('.last-move-marker')).not.toBeInTheDocument()
    expect(document.querySelector('.piece-last-move-marker')).toBeInTheDocument()
  })
})
