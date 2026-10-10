import { expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach } from 'vitest'
import FixableText from './FixableText'

afterEach(cleanup)

const entries = (text, low = {}) => Array.from(text, (ch, i) => ({ ch, conf: low[i] ?? 99 }))
const charAt = (i) => document.querySelector(`[data-i="${i}"]`)
const setup = (text, low) => {
  const onAdd = vi.fn()
  const view = render(<FixableText entries={entries(text, low)} onAdd={onAdd} />)
  return { onAdd, ...view }
}

test('underlines characters the engine was unsure of', () => {
  setup('ワンビース', { 2: 40 })
  expect(charAt(2).className).toContain('unsure')
  expect(charAt(0).className).not.toContain('unsure')
})

test('a wrong character becomes a corrected glossary word, with context', () => {
  const { onAdd } = setup('ワンビース', { 2: 40 })
  fireEvent.click(charAt(2))
  fireEvent.change(screen.getByLabelText('Correct text'), { target: { value: 'ピ' } })
  fireEvent.click(screen.getByText(/^Add word:/))
  expect(onAdd).toHaveBeenCalledWith('ワンピース') // two characters of context either side
})

test('or an always-replace rule', () => {
  const { onAdd } = setup('ワンビース', { 2: 40 })
  fireEvent.click(charAt(2))
  fireEvent.change(screen.getByLabelText('Correct text'), { target: { value: 'ピ' } })
  fireEvent.click(screen.getByText(/^Always replace:/))
  expect(onAdd).toHaveBeenCalledWith('ワンビース → ワンピース')
})

test('the amount of context can be changed', () => {
  const { onAdd } = setup('ワンビース', { 2: 40 })
  fireEvent.click(charAt(2))
  fireEvent.change(screen.getByLabelText('Correct text'), { target: { value: 'ピ' } })
  fireEvent.change(screen.getByLabelText('Characters of context'), { target: { value: '1' } })
  fireEvent.click(screen.getByText(/^Add word:/))
  expect(onAdd).toHaveBeenCalledWith('ンピー')
})

test('nothing can be added until the text is changed', () => {
  setup('ワンビース')
  fireEvent.click(charAt(2))
  expect(screen.getByText(/^Add word:/).disabled).toBe(true)
  expect(screen.getByText(/^Always replace:/).disabled).toBe(true)
})

test('clicking a neighbour extends the selection, and shift-click selects a range', () => {
  setup('ワンビース')
  fireEvent.click(charAt(2))
  fireEvent.click(charAt(3))
  expect(screen.getByLabelText('Correct text').value).toBe('ビー')
  fireEvent.click(charAt(0), { shiftKey: true })
  expect(screen.getByLabelText('Correct text').value).toBe('ワンビー')
})

test('a selection never crosses a line break', () => {
  const view = render(<FixableText entries={entries('ab\ncd')} onAdd={() => {}} />)
  fireEvent.click(charAt(0))
  fireEvent.click(charAt(3), { shiftKey: true })
  expect(screen.getByLabelText('Correct text').value).toBe('a')
  view.unmount()
})

test('clicking the only selected character again clears the selection', () => {
  setup('ワンビース')
  fireEvent.click(charAt(2))
  fireEvent.click(charAt(2))
  expect(screen.queryByLabelText('Correct text')).toBeNull()
})

test('the selection resets when the text changes', () => {
  const { rerender, onAdd } = setup('ワンビース')
  fireEvent.click(charAt(2))
  rerender(<FixableText entries={entries('ワンピース')} onAdd={onAdd} />)
  expect(screen.queryByLabelText('Correct text')).toBeNull()
})
