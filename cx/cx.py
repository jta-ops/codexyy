#!/usr/bin/env python3
"""cx - a minimalist programming language."""

import sys
import os
import json
import time
import ssl
import urllib.request
import urllib.error

__version__ = "0.1.0"

# ─── Token Types ────────────────────────────────────────────────────────────────

class TT:
    NUM = "NUM"
    STR = "STR"
    IDENT = "IDENT"
    PLUS = "PLUS"
    MINUS = "MINUS"
    STAR = "STAR"
    SLASH = "SLASH"
    PERCENT = "PERCENT"
    EQ = "EQ"
    EQEQ = "EQEQ"
    NEQ = "NEQ"
    LT = "LT"
    GT = "GT"
    LTE = "LTE"
    GTE = "GTE"
    AND = "AND"
    OR = "OR"
    NOT = "NOT"
    ASSIGN = "ASSIGN"
    LBRACE = "LBRACE"
    RBRACE = "RBRACE"
    LBRACKET = "LBRACKET"
    RBRACKET = "RBRACKET"
    LPAREN = "LPAREN"
    RPAREN = "RPAREN"
    COMMA = "COMMA"
    DOT = "DOT"
    COLON = "COLON"
    FN = "FN"
    IF = "IF"
    ELIF = "ELIF"
    ELSE = "ELSE"
    FOR = "FOR"
    IN = "IN"
    WHILE = "WHILE"
    RETURN = "RETURN"
    BREAK = "BREAK"
    CONTINUE = "CONTINUE"
    TRUE = "TRUE"
    FALSE = "FALSE"
    NIL = "NIL"
    EOF = "EOF"

KEYWORDS = {
    "fn": TT.FN, "if": TT.IF, "elif": TT.ELIF, "else": TT.ELSE,
    "for": TT.FOR, "in": TT.IN, "while": TT.WHILE, "return": TT.RETURN,
    "break": TT.BREAK, "continue": TT.CONTINUE,
    "true": TT.TRUE, "false": TT.FALSE, "nil": TT.NIL,
    "and": TT.AND, "or": TT.OR, "not": TT.NOT,
}

class Token:
    __slots__ = ("type", "value", "line")
    def __init__(self, type, value, line):
        self.type = type
        self.value = value
        self.line = line
    def __repr__(self):
        return f"Token({self.type}, {self.value!r})"

# ─── Lexer ──────────────────────────────────────────────────────────────────────

class Lexer:
    def __init__(self, source):
        self.source = source
        self.pos = 0
        self.line = 1
        self.tokens = []

    def error(self, msg):
        raise CxError(f"Lexer error at line {self.line}: {msg}")

    def peek(self):
        return self.source[self.pos] if self.pos < len(self.source) else "\0"

    def advance(self):
        ch = self.source[self.pos]
        self.pos += 1
        if ch == "\n":
            self.line += 1
        return ch

    def match(self, expected):
        if self.pos < len(self.source) and self.source[self.pos] == expected:
            self.pos += 1
            return True
        return False

    def tokenize(self):
        while self.pos < len(self.source):
            ch = self.peek()
            if ch in " \t\r":
                self.advance()
            elif ch == "\n":
                self.advance()
            elif ch == "#":
                while self.pos < len(self.source) and self.peek() != "\n":
                    self.advance()
            elif ch == '"':
                self._string()
            elif ch.isdigit():
                self._number()
            elif ch.isalpha() or ch == "_":
                self._identifier()
            elif ch == "+":
                self.advance()
                self.tokens.append(Token(TT.PLUS, "+", self.line))
            elif ch == "-":
                self.advance()
                self.tokens.append(Token(TT.MINUS, "-", self.line))
            elif ch == "*":
                self.advance()
                self.tokens.append(Token(TT.STAR, "*", self.line))
            elif ch == "/":
                self.advance()
                self.tokens.append(Token(TT.SLASH, "/", self.line))
            elif ch == "%":
                self.advance()
                self.tokens.append(Token(TT.PERCENT, "%", self.line))
            elif ch == "=":
                self.advance()
                if self.match("="):
                    self.tokens.append(Token(TT.EQEQ, "==", self.line))
                else:
                    self.tokens.append(Token(TT.ASSIGN, "=", self.line))
            elif ch == "!":
                self.advance()
                if self.match("="):
                    self.tokens.append(Token(TT.NEQ, "!=", self.line))
                else:
                    self.error(f"Unexpected character '!'")
            elif ch == "<":
                self.advance()
                if self.match("="):
                    self.tokens.append(Token(TT.LTE, "<=", self.line))
                else:
                    self.tokens.append(Token(TT.LT, "<", self.line))
            elif ch == ">":
                self.advance()
                if self.match("="):
                    self.tokens.append(Token(TT.GTE, ">=", self.line))
                else:
                    self.tokens.append(Token(TT.GT, ">", self.line))
            elif ch == "{":
                self.advance()
                self.tokens.append(Token(TT.LBRACE, "{", self.line))
            elif ch == "}":
                self.advance()
                self.tokens.append(Token(TT.RBRACE, "}", self.line))
            elif ch == "[":
                self.advance()
                self.tokens.append(Token(TT.LBRACKET, "[", self.line))
            elif ch == "]":
                self.advance()
                self.tokens.append(Token(TT.RBRACKET, "]", self.line))
            elif ch == "(":
                self.advance()
                self.tokens.append(Token(TT.LPAREN, "(", self.line))
            elif ch == ")":
                self.advance()
                self.tokens.append(Token(TT.RPAREN, ")", self.line))
            elif ch == ",":
                self.advance()
                self.tokens.append(Token(TT.COMMA, ",", self.line))
            elif ch == ".":
                self.advance()
                self.tokens.append(Token(TT.DOT, ".", self.line))
            elif ch == ":":
                self.advance()
                self.tokens.append(Token(TT.COLON, ":", self.line))
            else:
                self.error(f"Unexpected character '{ch}'")

        self.tokens.append(Token(TT.EOF, None, self.line))
        return self.tokens

    def _number(self):
        start = self.pos
        line = self.line
        while self.pos < len(self.source) and (self.peek().isdigit() or self.peek() == "."):
            self.advance()
        text = self.source[start:self.pos]
        try:
            val = int(text) if "." not in text else float(text)
        except ValueError:
            self.error(f"Invalid number: {text}")
        self.tokens.append(Token(TT.NUM, val, line))

    def _string(self):
        line = self.line
        self.advance()  # skip opening "
        parts = []
        current = ""
        while self.pos < len(self.source) and self.peek() != '"':
            if self.peek() == "\\":
                self.advance()
                ch = self.advance()
                if ch == "n":
                    current += "\n"
                elif ch == "t":
                    current += "\t"
                elif ch == "\\":
                    current += "\\"
                elif ch == '"':
                    current += '"'
                elif ch == "{":
                    current += "{"
                elif ch == "}":
                    current += "}"
                else:
                    current += "\\" + ch
            elif self.peek() == "{":
                if current:
                    parts.append(("str", current))
                    current = ""
                self.advance()  # skip {
                expr = ""
                depth = 1
                while self.pos < len(self.source) and depth > 0:
                    ch = self.advance()
                    if ch == "{":
                        depth += 1
                        expr += ch
                    elif ch == "}":
                        depth -= 1
                        if depth > 0:
                            expr += ch
                    else:
                        expr += ch
                parts.append(("expr", expr.strip()))
            else:
                current += self.advance()
        if self.pos >= len(self.source):
            self.error("Unterminated string")
        self.advance()  # skip closing "
        if current:
            parts.append(("str", current))
        if any(kind == "expr" for kind, _ in parts):
            self.tokens.append(Token(TT.STR, ("interp", parts), line))
        else:
            self.tokens.append(Token(TT.STR, ("plain", "".join(s for _, s in parts)), line))

    def _identifier(self):
        start = self.pos
        line = self.line
        while self.pos < len(self.source) and (self.peek().isalnum() or self.peek() == "_"):
            self.advance()
        text = self.source[start:self.pos]
        tt = KEYWORDS.get(text, TT.IDENT)
        self.tokens.append(Token(tt, text, line))

# ─── AST Nodes ──────────────────────────────────────────────────────────────────

class Node: pass

class Program(Node):
    def __init__(self, stmts): self.stmts = stmts

class Assign(Node):
    def __init__(self, name, value, line): self.name = name; self.value = value; self.line = line

class IndexAssign(Node):
    def __init__(self, obj, index, value, line): self.obj = obj; self.index = index; self.value = value; self.line = line

class FnDef(Node):
    def __init__(self, name, params, defaults, body, line): self.name = name; self.params = params; self.defaults = defaults; self.body = body; self.line = line

class If(Node):
    def __init__(self, branches, else_body, line): self.branches = branches; self.else_body = else_body; self.line = line

class For(Node):
    def __init__(self, var, iterable, body, line): self.var = var; self.iterable = iterable; self.body = body; self.line = line

class While(Node):
    def __init__(self, cond, body, line): self.cond = cond; self.body = body; self.line = line

class Return(Node):
    def __init__(self, value, line): self.value = value; self.line = line

class Break(Node):
    def __init__(self, line): self.line = line

class Continue(Node):
    def __init__(self, line): self.line = line

class BinOp(Node):
    def __init__(self, op, left, right, line): self.op = op; self.left = left; self.right = right; self.line = line

class UnaryOp(Node):
    def __init__(self, op, operand, line): self.op = op; self.operand = operand; self.line = line

class Call(Node):
    def __init__(self, callee, args, line): self.callee = callee; self.args = args; self.line = line

class Index(Node):
    def __init__(self, obj, index, line): self.obj = obj; self.index = index; self.line = line

class ListLit(Node):
    def __init__(self, elements, line): self.elements = elements; self.line = line

class DictLit(Node):
    def __init__(self, pairs, line): self.pairs = pairs; self.line = line

class Identifier(Node):
    def __init__(self, name, line): self.name = name; self.line = line

class Literal(Node):
    def __init__(self, value, line): self.value = value; self.line = line

class StringInterp(Node):
    def __init__(self, parts, line): self.parts = parts; self.line = line

# ─── Parser ─────────────────────────────────────────────────────────────────────

class CxError(Exception): pass

class BreakSignal(Exception): pass
class ContinueSignal(Exception): pass
class ReturnSignal(Exception):
    def __init__(self, value): self.value = value

PREC = {
    "or": 1, "and": 2,
    "==": 3, "!=": 3, "<": 3, ">": 3, "<=": 3, ">=": 3,
    "+": 4, "-": 4,
    "*": 5, "/": 5, "%": 5,
}

class Parser:
    def __init__(self, tokens):
        self.tokens = tokens
        self.pos = 0

    def error(self, msg, token=None):
        t = token or self.current()
        raise CxError(f"Error at line {t.line}: {msg}")

    def current(self):
        return self.tokens[self.pos]

    def peek(self, offset=0):
        idx = self.pos + offset
        return self.tokens[idx] if idx < len(self.tokens) else self.tokens[-1]

    def advance(self):
        t = self.tokens[self.pos]
        self.pos += 1
        return t

    def expect(self, tt):
        t = self.current()
        if t.type != tt:
            self.error(f"Expected {tt}, got {t.type}", t)
        return self.advance()

    def match(self, *types):
        if self.current().type in types:
            return self.advance()
        return None

    def parse(self):
        stmts = []
        while self.current().type != TT.EOF:
            stmts.append(self._stmt())
        return Program(stmts)

    def _stmt(self):
        t = self.current()
        if t.type == TT.FN:
            return self._fn_def()
        if t.type == TT.IF:
            return self._if()
        if t.type == TT.FOR:
            return self._for()
        if t.type == TT.WHILE:
            return self._while()
        if t.type == TT.RETURN:
            return self._return()
        if t.type == TT.BREAK:
            line = self.advance().line
            return Break(line)
        if t.type == TT.CONTINUE:
            line = self.advance().line
            return Continue(line)
        return self._assign_or_expr()

    def _fn_def(self):
        line = self.expect(TT.FN).line
        name = self.expect(TT.IDENT).value
        self.expect(TT.LPAREN)
        params = []
        defaults = {}
        while self.current().type != TT.RPAREN:
            if params:
                self.expect(TT.COMMA)
            p = self.expect(TT.IDENT).value
            if self.match(TT.ASSIGN):
                defaults[p] = self._expr()
            params.append(p)
        self.expect(TT.RPAREN)
        body = self._block()
        return FnDef(name, params, defaults, body, line)

    def _if(self):
        line = self.expect(TT.IF).line
        branches = []
        cond = self._expr()
        body = self._block()
        branches.append((cond, body))
        while self.match(TT.ELIF):
            cond = self._expr()
            body = self._block()
            branches.append((cond, body))
        else_body = None
        if self.match(TT.ELSE):
            else_body = self._block()
        return If(branches, else_body, line)

    def _for(self):
        line = self.expect(TT.FOR).line
        var = self.expect(TT.IDENT).value
        self.expect(TT.IN)
        iterable = self._expr()
        body = self._block()
        return For(var, iterable, body, line)

    def _while(self):
        line = self.expect(TT.WHILE).line
        cond = self._expr()
        body = self._block()
        return While(cond, body, line)

    def _return(self):
        line = self.expect(TT.RETURN).line
        value = None
        if self.current().type not in (TT.RBRACE, TT.EOF):
            value = self._expr()
        return Return(value, line)

    def _block(self):
        self.expect(TT.LBRACE)
        stmts = []
        while self.current().type != TT.RBRACE:
            stmts.append(self._stmt())
        self.expect(TT.RBRACE)
        return stmts

    def _assign_or_expr(self):
        expr = self._expr()
        if isinstance(expr, Identifier) and self.current().type == TT.ASSIGN:
            self.advance()
            value = self._expr()
            return Assign(expr.name, value, expr.line)
        if isinstance(expr, Index) and self.current().type == TT.ASSIGN:
            self.advance()
            value = self._expr()
            return IndexAssign(expr.obj, expr.index, value, expr.line)
        return expr

    def _expr(self):
        return self._binary(0)

    def _binary(self, min_prec):
        left = self._unary()
        while True:
            t = self.current()
            if t.type == TT.EQEQ:
                op = "=="
            elif t.type == TT.NEQ:
                op = "!="
            elif t.type == TT.LT:
                op = "<"
            elif t.type == TT.GT:
                op = ">"
            elif t.type == TT.LTE:
                op = "<="
            elif t.type == TT.GTE:
                op = ">="
            elif t.type == TT.PLUS:
                op = "+"
            elif t.type == TT.MINUS:
                op = "-"
            elif t.type == TT.STAR:
                op = "*"
            elif t.type == TT.SLASH:
                op = "/"
            elif t.type == TT.PERCENT:
                op = "%"
            elif t.type == TT.AND:
                op = "and"
            elif t.type == TT.OR:
                op = "or"
            else:
                break
            prec = PREC.get(op, 0)
            if prec < min_prec:
                break
            self.advance()
            right = self._binary(prec + 1)
            left = BinOp(op, left, right, t.line)
        return left

    def _unary(self):
        if self.current().type == TT.MINUS:
            line = self.advance().line
            operand = self._unary()
            return UnaryOp("-", operand, line)
        if self.current().type == TT.NOT:
            line = self.advance().line
            operand = self._unary()
            return UnaryOp("not", operand, line)
        return self._postfix()

    def _postfix(self):
        expr = self._primary()
        while True:
            if self.current().type == TT.LPAREN:
                self.advance()
                args = []
                while self.current().type != TT.RPAREN:
                    if args:
                        self.expect(TT.COMMA)
                    args.append(self._expr())
                self.expect(TT.RPAREN)
                expr = Call(expr, args, expr.line if hasattr(expr, "line") else 0)
            elif self.current().type == TT.LBRACKET:
                self.advance()
                index = self._expr()
                self.expect(TT.RBRACKET)
                expr = Index(expr, index, expr.line if hasattr(expr, "line") else 0)
            else:
                break
        return expr

    def _primary(self):
        t = self.current()
        if t.type == TT.NUM:
            self.advance()
            return Literal(t.value, t.line)
        if t.type == TT.STR:
            self.advance()
            kind, data = t.value
            if kind == "plain":
                return Literal(data, t.line)
            else:
                parts = []
                for pkind, pval in data:
                    if pkind == "str":
                        parts.append(("str", pval))
                    else:
                        lex = Lexer(pval)
                        toks = lex.tokenize()
                        par = Parser(toks)
                        parts.append(("expr", par._expr()))
                return StringInterp(parts, t.line)
        if t.type == TT.TRUE:
            self.advance()
            return Literal(True, t.line)
        if t.type == TT.FALSE:
            self.advance()
            return Literal(False, t.line)
        if t.type == TT.NIL:
            self.advance()
            return Literal(None, t.line)
        if t.type == TT.IDENT:
            self.advance()
            return Identifier(t.value, t.line)
        if t.type == TT.LPAREN:
            self.advance()
            expr = self._expr()
            self.expect(TT.RPAREN)
            return expr
        if t.type == TT.LBRACKET:
            return self._list_lit()
        if t.type == TT.LBRACE and self.peek(1).type in (TT.STR, TT.RBRACE):
            return self._dict_lit()
        self.error(f"Unexpected token {t.type}", t)

    def _list_lit(self):
        line = self.expect(TT.LBRACKET).line
        elements = []
        while self.current().type != TT.RBRACKET:
            if elements:
                self.expect(TT.COMMA)
            if self.current().type == TT.RBRACKET:
                break
            elements.append(self._expr())
        self.expect(TT.RBRACKET)
        return ListLit(elements, line)

    def _dict_lit(self):
        line = self.expect(TT.LBRACE).line
        pairs = []
        while self.current().type != TT.RBRACE:
            if pairs:
                self.expect(TT.COMMA)
            if self.current().type == TT.RBRACE:
                break
            key = self._expr()
            self.expect(TT.COLON)
            val = self._expr()
            pairs.append((key, val))
        self.expect(TT.RBRACE)
        return DictLit(pairs, line)

# ─── Environment ────────────────────────────────────────────────────────────────

class Environment:
    def __init__(self, parent=None):
        self.vars = {}
        self.parent = parent

    def get(self, name):
        if name in self.vars:
            return self.vars[name]
        if self.parent:
            return self.parent.get(name)
        raise CxError(f"Undefined variable '{name}'")

    def set(self, name, value):
        if name in self.vars:
            self.vars[name] = value
            return
        if self.parent and self.parent.has(name):
            self.parent.set(name, value)
            return
        self.vars[name] = value

    def has(self, name):
        if name in self.vars:
            return True
        if self.parent:
            return self.parent.has(name)
        return False

    def define(self, name, value):
        self.vars[name] = value

# ─── Interpreter ────────────────────────────────────────────────────────────────

class CxFunction:
    def __init__(self, name, params, defaults, body, closure):
        self.name = name
        self.params = params
        self.defaults = defaults
        self.body = body
        self.closure = closure

class BuiltinFunction:
    def __init__(self, name, fn):
        self.name = name
        self.fn = fn

class Interpreter:
    def __init__(self):
        self.global_env = Environment()
        self._setup_builtins()

    def _setup_builtins(self):
        import math
        import random as _random

        def _print(*args):
            print(*[self._to_str(a) for a in args])
            return None

        def _input(prompt=""):
            if prompt:
                print(prompt, end="", flush=True)
            return input()

        def _len(x):
            if isinstance(x, (list, str, dict)):
                return len(x)
            raise CxError(f"len() not supported for {type(x).__name__}")

        def _type(x):
            if x is None: return "nil"
            if isinstance(x, bool): return "bool"
            if isinstance(x, (int, float)): return "num"
            if isinstance(x, str): return "str"
            if isinstance(x, list): return "list"
            if isinstance(x, dict): return "dict"
            if isinstance(x, (CxFunction, BuiltinFunction)): return "fn"
            return "unknown"

        def _str(x): return self._to_str(x)
        def _num(x):
            try: return int(x) if isinstance(x, str) and "." not in x else float(x)
            except: return None
        def _range_val(*args):
            if len(args) == 1: return list(range(int(args[0])))
            if len(args) == 2: return list(range(int(args[0]), int(args[1])))
            raise CxError("range() takes 1 or 2 arguments")
        def _push(lst, val): lst.append(val); return None
        def _pop(lst):
            if not lst: raise CxError("pop() on empty list")
            return lst.pop()
        def _keys(d): return list(d.keys())
        def _has(d, k): return k in d
        def _abs(x): return abs(x)
        def _max(a, b): return max(a, b)
        def _min(a, b): return min(a, b)
        def _floor(x): return math.floor(x)
        def _ceil(x): return math.ceil(x)
        def _sqrt(x): return math.sqrt(x)
        def _random(): return _random.random()
        def _upper(s): return s.upper() if isinstance(s, str) else str(s).upper()
        def _lower(s): return s.lower() if isinstance(s, str) else str(s).lower()
        def _trim(s): return s.strip() if isinstance(s, str) else str(s).strip()
        def _split(s, sep): return s.split(sep) if isinstance(s, str) else [str(s)]
        def _join(lst, sep): return sep.join([self._to_str(x) for x in lst])
        def _replace(s, old, new): return s.replace(old, new) if isinstance(s, str) else str(s).replace(str(old), str(new))
        def _starts_with(s, pfx): return s.startswith(pfx) if isinstance(s, str) else False
        def _ends_with(s, sfx): return s.endswith(sfx) if isinstance(s, str) else False
        def _slice_val(s, start, end=None):
            if end is None: return s[int(start):]
            return s[int(start):int(end)]

        builtins = {
            "print": _print, "input": _input, "len": _len, "type": _type,
            "str": _str, "num": _num, "range": _range_val,
            "push": _push, "pop": _pop, "keys": _keys, "has": _has,
            "abs": _abs, "max": _max, "min": _min,
            "floor": _floor, "ceil": _ceil, "sqrt": _sqrt, "random": _random,
            "upper": _upper, "lower": _lower, "trim": _trim,
            "split": _split, "join": _join, "replace": _replace,
            "starts_with": _starts_with, "ends_with": _ends_with,
            "slice": _slice_val,
        }
        for name, fn in builtins.items():
            self.global_env.define(name, BuiltinFunction(name, fn))

    def _to_str(self, val):
        if val is None: return "nil"
        if isinstance(val, bool): return "true" if val else "false"
        if isinstance(val, float): return str(int(val)) if val == int(val) else str(val)
        if isinstance(val, list): return "[" + ", ".join(self._to_str(v) for v in val) + "]"
        if isinstance(val, dict): return "{" + ", ".join(f"{self._to_str(k)}: {self._to_str(v)}" for k, v in val.items()) + "}"
        return str(val)

    def run(self, source):
        lexer = Lexer(source)
        tokens = lexer.tokenize()
        parser = Parser(tokens)
        program = parser.parse()
        return self._exec(program, self.global_env)

    def run_file(self, path):
        with open(path, "r", errors="replace") as f:
            source = f.read()
        return self.run(source)

    def _exec(self, node, env):
        if isinstance(node, Program):
            result = None
            for stmt in node.stmts:
                result = self._exec(stmt, env)
            return result
        if isinstance(node, Literal):
            return node.value
        if isinstance(node, Identifier):
            return env.get(node.name)
        if isinstance(node, StringInterp):
            parts = []
            for kind, val in node.parts:
                if kind == "str":
                    parts.append(val)
                else:
                    parts.append(self._to_str(self._exec(val, env)))
            return "".join(parts)
        if isinstance(node, ListLit):
            return [self._exec(e, env) for e in node.elements]
        if isinstance(node, DictLit):
            result = {}
            for k, v in node.pairs:
                key = self._exec(k, env)
                val = self._exec(v, env)
                result[key] = val
            return result
        if isinstance(node, Assign):
            val = self._exec(node.value, env)
            env.set(node.name, val)
            return val
        if isinstance(node, IndexAssign):
            obj = self._exec(node.obj, env)
            idx = self._exec(node.index, env)
            val = self._exec(node.value, env)
            if isinstance(obj, list):
                obj[int(idx)] = val
            elif isinstance(obj, dict):
                obj[idx] = val
            return val
        if isinstance(node, BinOp):
            if node.op == "and":
                left = self._exec(node.left, env)
                return left if not self._truthy(left) else self._exec(node.right, env)
            if node.op == "or":
                left = self._exec(node.left, env)
                return left if self._truthy(left) else self._exec(node.right, env)
            left = self._exec(node.left, env)
            right = self._exec(node.right, env)
            return self._binop(node.op, left, right, node.line)
        if isinstance(node, UnaryOp):
            operand = self._exec(node.operand, env)
            if node.op == "-": return -operand
            if node.op == "not": return not self._truthy(operand)
        if isinstance(node, Call):
            callee = self._exec(node.callee, env)
            args = [self._exec(a, env) for a in node.args]
            return self._call(callee, args, env, node.line)
        if isinstance(node, Index):
            obj = self._exec(node.obj, env)
            idx = self._exec(node.index, env)
            if isinstance(obj, list):
                idx = int(idx)
                if idx < 0: idx += len(obj)
                return obj[idx]
            if isinstance(obj, dict):
                return obj.get(idx)
            raise CxError(f"Cannot index {type(obj).__name__}")
        if isinstance(node, FnDef):
            fn = CxFunction(node.name, node.params, node.defaults, node.body, env)
            env.define(node.name, fn)
            return fn
        if isinstance(node, If):
            for cond, body in node.branches:
                if self._truthy(self._exec(cond, env)):
                    result = None
                    for stmt in body:
                        result = self._exec(stmt, env)
                    return result
            if node.else_body:
                result = None
                for stmt in node.else_body:
                    result = self._exec(stmt, env)
                return result
            return None
        if isinstance(node, For):
            iterable = self._exec(node.iterable, env)
            for item in iterable:
                env.set(node.var, item)
                try:
                    for stmt in node.body:
                        self._exec(stmt, env)
                except BreakSignal:
                    break
                except ContinueSignal:
                    continue
            return None
        if isinstance(node, While):
            while self._truthy(self._exec(node.cond, env)):
                try:
                    for stmt in node.body:
                        self._exec(stmt, env)
                except BreakSignal:
                    break
                except ContinueSignal:
                    continue
            return None
        if isinstance(node, Return):
            val = self._exec(node.value, env) if node.value else None
            raise ReturnSignal(val)
        if isinstance(node, Break):
            raise BreakSignal()
        if isinstance(node, Continue):
            raise ContinueSignal()
        raise CxError(f"Unknown node type: {type(node).__name__}")

    def _truthy(self, val):
        if val is None: return False
        if isinstance(val, bool): return val
        if isinstance(val, (int, float)): return val != 0
        if isinstance(val, str): return len(val) > 0
        if isinstance(val, list): return len(val) > 0
        if isinstance(val, dict): return len(val) > 0
        return True

    def _binop(self, op, left, right, line):
        if op == "+": return left + right
        if op == "-": return left - right
        if op == "*": return left * right
        if op == "/":
            if right == 0: raise CxError(f"Division by zero")
            return left / right
        if op == "%": return left % right
        if op == "==": return left == right
        if op == "!=": return left != right
        if op == "<": return left < right
        if op == ">": return left > right
        if op == "<=": return left <= right
        if op == ">=": return left >= right
        raise CxError(f"Unknown operator: {op}")

    def _call(self, callee, args, env, line):
        if isinstance(callee, BuiltinFunction):
            return callee.fn(*args)
        if isinstance(callee, CxFunction):
            if len(args) > len(callee.params):
                raise CxError(f"Wrong number of arguments for {callee.name}: expected {len(callee.params)}, got {len(args)}")
            fn_env = Environment(callee.closure)
            for i, param in enumerate(callee.params):
                if i < len(args):
                    fn_env.define(param, args[i])
                else:
                    if param in callee.defaults:
                        fn_env.define(param, self._exec(callee.defaults[param], env))
                    else:
                        raise CxError(f"Missing argument '{param}' for {callee.name}")
            try:
                result = None
                for stmt in callee.body:
                    result = self._exec(stmt, fn_env)
                return result
            except ReturnSignal as r:
                return r.value
        raise CxError(f"Not callable: {callee}")

# ─── CLI ─────────────────────────────────────────────────────────────────────────

CX_DIR = os.path.expanduser("~/.cx")

def cmd_run(args):
    if not args:
        print("Usage: cx run <file.cx>")
        sys.exit(1)
    path = args[0]
    if not os.path.isfile(path):
        print(f"Error: file not found: {path}")
        sys.exit(1)
    interp = Interpreter()
    try:
        interp.run_file(path)
    except CxError as e:
        print(f"Error: {e}")
        sys.exit(1)
    except ReturnSignal:
        pass

def cmd_repl(args):
    interp = Interpreter()
    print(f"cx v{__version__} — type 'exit' to quit")
    while True:
        try:
            line = input("cx> ")
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if line.strip() in ("exit", "quit"):
            break
        if not line.strip():
            continue
        try:
            result = interp.run(line)
            if result is not None:
                print(interp._to_str(result))
        except CxError as e:
            print(f"Error: {e}")

def cmd_gpt(args):
    try:
        import websocket
    except ImportError:
        print("  websocket-client is required for cx gpt.")
        print("  Install it with: pip3 install websocket-client")
        sys.exit(1)

    BASE = "https://codexyy.dev"
    WS_BASE = "wss://codexyy.dev"

    print(f"  Creating session...")
    req = urllib.request.Request(f"{BASE}/api/cx/session", method="POST", data=b"{}")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        print(f"  Error connecting: {e}")
        sys.exit(1)

    code = data["code"]
    url = f"{BASE}/cx/{code}"
    print(f"\n  Session code: {code}")
    print(f"  Share with AI: {url}")
    print(f"\n  Waiting for connections...\n")

    ws_dir = os.path.join(os.getcwd(), "cxgpt")
    os.makedirs(ws_dir, exist_ok=True)
    print(f"  Workspace: {ws_dir}/\n")

    interp = Interpreter()

    def on_message(ws, message):
        try:
            msg = json.loads(message)
            mtype = msg.get("type")
            mid = msg.get("id", "")

            if mtype == "cx_run":
                source = msg.get("source", "")
                try:
                    import io
                    old_stdout = sys.stdout
                    buf = io.StringIO()
                    sys.stdout = buf
                    result = interp.run(source)
                    sys.stdout = old_stdout
                    output = buf.getvalue()
                    ws.send(json.dumps({"type": "cx_result", "id": mid, "output": output, "error": None, "exit_code": 0}))
                except CxError as e:
                    sys.stdout = old_stdout
                    ws.send(json.dumps({"type": "cx_result", "id": mid, "output": "", "error": str(e), "exit_code": 1}))
                except Exception as e:
                    sys.stdout = old_stdout
                    ws.send(json.dumps({"type": "cx_result", "id": mid, "output": "", "error": str(e), "exit_code": 1}))

            elif mtype == "cx_files":
                files = []
                for f in sorted(os.listdir(ws_dir)):
                    fp = os.path.join(ws_dir, f)
                    if os.path.isfile(fp) and f.endswith(".cx"):
                        st = os.stat(fp)
                        files.append({"path": f, "size": st.st_size, "modified": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(st.st_mtime))})
                ws.send(json.dumps({"type": "cx_result", "id": mid, "files": files}))

            elif mtype == "cx_read":
                path = msg.get("path", "")
                safe = _safe_path(path)
                if not safe:
                    ws.send(json.dumps({"type": "cx_result", "id": mid, "error": "Invalid path", "content": None}))
                elif not os.path.isfile(safe):
                    ws.send(json.dumps({"type": "cx_result", "id": mid, "error": "File not found", "content": None}))
                else:
                    with open(safe, "r", errors="replace") as f:
                        content = f.read()
                    ws.send(json.dumps({"type": "cx_result", "id": mid, "path": path, "content": content, "lines": content.count("\n") + 1}))

            elif mtype == "cx_write":
                path = msg.get("path", "")
                content = msg.get("content", "")
                safe = _safe_path(path)
                if not safe:
                    ws.send(json.dumps({"type": "cx_result", "id": mid, "error": "Invalid path", "ok": False}))
                else:
                    os.makedirs(os.path.dirname(safe), exist_ok=True) if os.path.dirname(safe) else None
                    with open(safe, "w") as f:
                        f.write(content)
                    ws.send(json.dumps({"type": "cx_result", "id": mid, "path": path, "ok": True}))

            elif mtype == "cx_edit":
                path = msg.get("path", "")
                old = msg.get("old", "")
                new = msg.get("new", "")
                safe = _safe_path(path)
                if not safe or not os.path.isfile(safe):
                    ws.send(json.dumps({"type": "cx_result", "id": mid, "error": "File not found", "ok": False, "replacements": 0}))
                else:
                    with open(safe, "r", errors="replace") as f:
                        content = f.read()
                    count = content.count(old)
                    content = content.replace(old, new)
                    with open(safe, "w") as f:
                        f.write(content)
                    ws.send(json.dumps({"type": "cx_result", "id": mid, "path": path, "ok": True, "replacements": count}))

        except Exception as e:
            try:
                ws.send(json.dumps({"type": "error", "id": msg.get("id", ""), "message": str(e)}))
            except:
                pass

    def _safe_path(name):
        if ".." in name or name.startswith("/"):
            return None
        path = os.path.join(ws_dir, name)
        if not os.path.abspath(path).startswith(os.path.abspath(ws_dir)):
            return None
        return path

    def on_error(ws, err):
        print(f"  Connection error: {err}")

    def on_close(ws, close_status, close_msg):
        print("\n  Disconnected.")
        sys.exit(0)

    def on_open(ws):
        print("  Connected! Waiting for code from AI agents...\n")

    import time
    ssl_opts = {"cert_reqs": ssl.CERT_NONE}
    ws_app = websocket.WebSocketApp(
        f"{WS_BASE}/relay/{code}?client_type=cx",
        on_message=on_message,
        on_error=on_error,
        on_close=on_close,
        on_open=on_open,
    )
    ws_app.run_forever(sslopt=ssl_opts)

def cmd_version(args):
    print(f"cx v{__version__}")

def main():
    if len(sys.argv) < 2:
        print(f"cx v{__version__} — a minimalist programming language")
        print()
        print("Usage:")
        print("  cx run <file.cx>  Run a .cx file")
        print("  cx repl           Interactive REPL")
        print("  cx gpt            Start a GPT relay session")
        print("  cx version        Print version")
        sys.exit(0)

    cmd = sys.argv[1]
    args = sys.argv[2:]

    if cmd == "run":
        cmd_run(args)
    elif cmd == "repl":
        cmd_repl(args)
    elif cmd == "gpt":
        cmd_gpt(args)
    elif cmd == "version":
        cmd_version(args)
    else:
        print(f"Unknown command: {cmd}")
        print("Usage: cx [run|repl|gpt|version]")
        sys.exit(1)

if __name__ == "__main__":
    main()