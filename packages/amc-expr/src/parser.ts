/**
 * Pratt parser producing an AST, with Python's precedence and associativity.
 *
 * Parsing is separated from evaluation so an expression can be parsed once and
 * evaluated against many vehicles, and so a malformed expression in a step file
 * is reported before any flight controller is touched.
 */

import { type Token, tokenize } from './lexer.js'
import { PyError } from './values.js'

export type Node =
  | { kind: 'num'; value: number; isInt: boolean }
  | { kind: 'str'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'none' }
  | { kind: 'name'; id: string }
  | { kind: 'list'; items: Node[] }
  | { kind: 'index'; target: Node; key: Node }
  | { kind: 'call'; callee: Node; args: Node[] }
  | { kind: 'method'; target: Node; name: string; args: Node[] }
  | { kind: 'unary'; op: '-' | '+' | 'not'; operand: Node }
  | { kind: 'binary'; op: BinaryOp; left: Node; right: Node }
  | { kind: 'bool-op'; op: 'and' | 'or'; left: Node; right: Node }
  | { kind: 'compare'; op: CompareOp; left: Node; right: Node }
  | { kind: 'ternary'; cond: Node; then: Node; otherwise: Node }

export type BinaryOp = '+' | '-' | '*' | '/' | '//' | '%' | '**' | '<<' | '>>'
export type CompareOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not in'

/** Binding powers, lowest first, mirroring Python's precedence table. */
const BP = {
  or: 1,
  and: 2,
  not: 3,
  compare: 4,
  shift: 5,
  additive: 6,
  multiplicative: 7,
  unary: 8,
  power: 9,
  postfix: 10
} as const

const COMPARE_OPS = new Set(['==', '!=', '<', '<=', '>', '>='])

class Parser {
  private index = 0

  constructor(private readonly tokens: Token[]) {}

  private get current(): Token {
    return this.tokens[this.index] as Token
  }

  private at(value: string): boolean {
    return this.current.type === 'op' && this.current.value === value
  }

  private eat(value: string): boolean {
    if (!this.at(value)) return false
    this.index += 1
    return true
  }

  private expect(value: string): void {
    if (!this.eat(value)) {
      throw new PyError('SyntaxError', `expected ${JSON.stringify(value)} at position ${this.current.pos}`)
    }
  }

  parse(): Node {
    const node = this.expression()
    if (this.current.type !== 'eof') {
      throw new PyError('SyntaxError', `unexpected ${JSON.stringify(this.current.value)} at ${this.current.pos}`)
    }
    return node
  }

  /** Ternary sits outermost: `then if cond else otherwise`. */
  private expression(): Node {
    const then = this.binary(BP.or)
    if (!this.eat('if')) return then
    const cond = this.binary(BP.or)
    this.expect('else')
    // Right-associative, so a chained `a if p else b if q else c` nests.
    const otherwise = this.expression()
    return { kind: 'ternary', cond, then, otherwise }
  }

  private binary(minBp: number): Node {
    let left = this.unary()

    for (;;) {
      const token = this.current
      if (token.type !== 'op') break
      const op = token.value

      if (op === 'or' || op === 'and') {
        const bp = op === 'or' ? BP.or : BP.and
        if (bp < minBp) break
        this.index += 1
        const right = this.binary(bp + 1)
        left = { kind: 'bool-op', op, left, right }
        continue
      }

      if (COMPARE_OPS.has(op) || op === 'in' || op === 'not') {
        if (BP.compare < minBp) break
        let compareOp: CompareOp
        if (op === 'not') {
          // Only `not in` is a comparison; a bare `not` is prefix, handled below.
          if (this.tokens[this.index + 1]?.value !== 'in') break
          this.index += 2
          compareOp = 'not in'
        } else {
          this.index += 1
          compareOp = op as CompareOp
        }
        const right = this.binary(BP.compare + 1)
        left = { kind: 'compare', op: compareOp, left, right }
        continue
      }

      const arithmetic: Partial<Record<string, number>> = {
        '<<': BP.shift,
        '>>': BP.shift,
        '+': BP.additive,
        '-': BP.additive,
        '*': BP.multiplicative,
        '/': BP.multiplicative,
        '//': BP.multiplicative,
        '%': BP.multiplicative
      }
      const bp = arithmetic[op]
      if (bp === undefined || bp < minBp) break
      this.index += 1
      const right = this.binary(bp + 1)
      left = { kind: 'binary', op: op as BinaryOp, left, right }
    }

    return left
  }

  private unary(): Node {
    if (this.eat('not')) return { kind: 'unary', op: 'not', operand: this.binary(BP.not) }
    if (this.eat('-')) return { kind: 'unary', op: '-', operand: this.unary() }
    if (this.eat('+')) return { kind: 'unary', op: '+', operand: this.unary() }
    return this.power()
  }

  /** `**` binds tighter than unary minus on its left, and is right-associative. */
  private power(): Node {
    const base = this.postfix()
    if (!this.eat('**')) return base
    return { kind: 'binary', op: '**', left: base, right: this.unary() }
  }

  private postfix(): Node {
    let node = this.primary()
    for (;;) {
      if (this.eat('[')) {
        const key = this.expression()
        this.expect(']')
        node = { kind: 'index', target: node, key }
        continue
      }
      if (this.eat('(')) {
        node = { kind: 'call', callee: node, args: this.arguments() }
        continue
      }
      if (this.eat('.')) {
        const name = this.current
        if (name.type !== 'name') throw new PyError('SyntaxError', `expected attribute name at ${name.pos}`)
        this.index += 1
        this.expect('(')
        node = { kind: 'method', target: node, name: name.value, args: this.arguments() }
        continue
      }
      break
    }
    return node
  }

  /** Reads through the closing paren, which the caller has already opened. */
  private arguments(): Node[] {
    const args: Node[] = []
    if (this.eat(')')) return args
    do {
      args.push(this.expression())
    } while (this.eat(','))
    this.expect(')')
    return args
  }

  private primary(): Node {
    const token = this.current

    if (token.type === 'number') {
      this.index += 1
      return { kind: 'num', value: token.num as number, isInt: token.isInt === true }
    }
    if (token.type === 'string') {
      this.index += 1
      return { kind: 'str', value: token.value }
    }
    if (token.type === 'name') {
      this.index += 1
      return { kind: 'name', id: token.value }
    }
    if (this.eat('True')) return { kind: 'bool', value: true }
    if (this.eat('False')) return { kind: 'bool', value: false }
    if (this.eat('None')) return { kind: 'none' }
    if (this.eat('(')) {
      const inner = this.expression()
      this.expect(')')
      return inner
    }
    if (this.eat('[')) {
      const items: Node[] = []
      if (!this.eat(']')) {
        do {
          items.push(this.expression())
        } while (this.eat(','))
        this.expect(']')
      }
      return { kind: 'list', items }
    }

    throw new PyError('SyntaxError', `unexpected ${JSON.stringify(token.value || '<eof>')} at ${token.pos}`)
  }
}

export function parse(source: string): Node {
  return new Parser(tokenize(source)).parse()
}
