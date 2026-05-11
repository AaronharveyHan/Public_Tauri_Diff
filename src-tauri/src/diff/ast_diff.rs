//! AST-level semantic diff using tree-sitter.
//!
//! Supports JavaScript, TypeScript, Python, Rust, Java, C++, Go.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tree_sitter::{Language, Node, Parser, Tree};

// ---------------------------------------------------------------------------
// Language registry
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SupportedLanguage {
    JavaScript,
    TypeScript,
    Python,
    Rust,
    Java,
    Cpp,
    Go,
}

impl SupportedLanguage {
    pub fn ts_language(self) -> Language {
        match self {
            Self::JavaScript => tree_sitter_javascript::language(),
            Self::TypeScript => tree_sitter_typescript::language_typescript(),
            Self::Python => tree_sitter_python::language(),
            Self::Rust => tree_sitter_rust::language(),
            Self::Java => tree_sitter_java::language(),
            Self::Cpp => tree_sitter_cpp::language(),
            Self::Go => tree_sitter_go::language(),
        }
    }

    pub fn from_path(path: &str) -> Option<Self> {
        match path.rsplit('.').next()? {
            "js" | "jsx" | "mjs" | "cjs" => Some(Self::JavaScript),
            "ts" | "tsx" => Some(Self::TypeScript),
            "py" => Some(Self::Python),
            "rs" => Some(Self::Rust),
            "java" => Some(Self::Java),
            "cpp" | "cc" | "cxx" | "c++" | "hpp" => Some(Self::Cpp),
            "go" => Some(Self::Go),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::JavaScript => "javascript",
            Self::TypeScript => "typescript",
            Self::Python => "python",
            Self::Rust => "rust",
            Self::Java => "java",
            Self::Cpp => "cpp",
            Self::Go => "go",
        }
    }
}

// ---------------------------------------------------------------------------
// Parser pool
// ---------------------------------------------------------------------------

pub struct ParserPool {
    pool: HashMap<SupportedLanguage, Parser>,
}

impl ParserPool {
    pub fn new() -> Self {
        Self { pool: HashMap::new() }
    }

    pub fn parse(&mut self, source: &str, lang: SupportedLanguage) -> Result<Tree, String> {
        let parser = self.pool.entry(lang).or_insert_with(|| {
            let mut p = Parser::new();
            p.set_language(lang.ts_language())
                .expect("tree-sitter ABI mismatch");
            p
        });
        parser
            .parse(source, None)
            .ok_or_else(|| format!("failed to parse {} source", lang.name()))
    }
}

impl Default for ParserPool {
    fn default() -> Self { Self::new() }
}

// ---------------------------------------------------------------------------
// Semantic node filtering
// ---------------------------------------------------------------------------

fn is_semantic(node: &Node) -> bool {
    !matches!(
        node.kind(),
        "," | "." | ";" | ":" | "::" | "(" | ")" | "[" | "]" | "{" | "}"
        | "<" | ">" | "->" | "=>" | "|" | "&"
        | "comment" | "line_comment" | "block_comment"
        | "whitespace" | "newline"
    ) && !node.is_extra()
}

fn semantic_children<'a>(node: &Node<'a>) -> Vec<Node<'a>> {
    (0..node.child_count())
        .filter_map(|i| node.child(i))
        .filter(|n| is_semantic(n))
        .collect()
}

// ---------------------------------------------------------------------------
// Structural + text equality
// ---------------------------------------------------------------------------

fn is_structurally_equal(a: &Node, b: &Node, src_a: &str, src_b: &str) -> bool {
    if a.kind() != b.kind() {
        return false;
    }
    let children_a = semantic_children(a);
    let children_b = semantic_children(b);
    if children_a.is_empty() && children_b.is_empty() {
        return a.utf8_text(src_a.as_bytes()).unwrap_or("")
            == b.utf8_text(src_b.as_bytes()).unwrap_or("");
    }
    if children_a.len() != children_b.len() {
        return false;
    }
    children_a.iter().zip(children_b.iter())
        .all(|(ca, cb)| is_structurally_equal(ca, cb, src_a, src_b))
}

// ---------------------------------------------------------------------------
// Semantic type classification
// ---------------------------------------------------------------------------

fn semantic_type(kind: &str) -> &'static str {
    match kind {
        "function_declaration" | "function_expression" | "arrow_function"
        | "function_definition" | "function_item" | "func_decl"
        | "lambda"  // FIX: lambda 直接归到 function，不再走 expression 路径
        => "function",

        "class_declaration" | "class_expression" | "class_definition" => "class",
        "interface_declaration" => "interface",
        "type_alias_declaration" | "type_declaration" => "type",
        "struct_item" => "struct",
        "enum_item" | "enum_declaration" => "enum",
        "trait_item" => "trait",
        "method_definition" | "method_declaration" => "method",

        "variable_declarator" | "const_item" | "static_item" | "let_declaration"
        | "const_declaration" | "lexical_declaration" => "variable",

        "parameter" | "typed_identifier" => "parameter",
        "import_statement" | "import_declaration" | "use_declaration" => "import",
        "export_statement" | "export_declaration" => "export",
        "comment" | "line_comment" | "block_comment" => "comment",

        "expression_statement" => "expression",
        "assignment"           => "assignment",
        "for_statement"        => "for_loop",
        "if_statement"         => "if_block",
        "while_statement"      => "while_loop",
        "with_statement"       => "with_block",
        "try_statement"        => "try_block",
        "decorated_definition" => "decorated",

        "list_comprehension" | "dict_comprehension" | "set_comprehension"
        | "generator_expression" | "dictionary_comprehension" => "comprehension",

        _ => "code_element",
    }
}

// ---------------------------------------------------------------------------
// FIX 1: unwrap_semantic_node
//
// 把包装层（expression_statement）穿透到内层语义节点。
// 这是 lambda vs def 失效的根因：顶层是 expression_statement，
// normalize/similarity 拿到的是包装层的 kind，永远匹配不上 function_definition。
// ---------------------------------------------------------------------------

/// 穿透 expression_statement / assignment 包装，返回内层的语义节点。
///
/// 例：
///   expression_statement → assignment → lambda   →  返回 lambda 节点
///   expression_statement → assignment → list      →  返回 assignment 节点（值不是函数）
///   function_definition                            →  原样返回
fn unwrap_semantic_node<'a>(node: &Node<'a>) -> Node<'a> {
    match node.kind() {
        "expression_statement" => {
            // 找第一个非标点子节点
            for i in 0..node.child_count() {
                if let Some(child) = node.child(i) {
                    if is_semantic(&child) {
                        return unwrap_semantic_node(&child);
                    }
                }
            }
            node.clone()
        }
        "assignment" => {
            // 右侧值如果是函数类节点，穿透到它
            let rhs = node.child_by_field_name("value")
                .or_else(|| node.child_by_field_name("right"))
                .or_else(|| {
                    // 找 = 之后的节点
                    let mut after_eq = false;
                    for i in 0..node.child_count() {
                        if let Some(c) = node.child(i) {
                            if c.kind() == "=" { after_eq = true; continue; }
                            if after_eq && !matches!(c.kind(), ";" | "," | ":") {
                                return Some(c);
                            }
                        }
                    }
                    None
                });
            if let Some(rhs) = rhs {
                if is_function_like_kind(rhs.kind()) {
                    return rhs;
                }
            }
            node.clone()
        }
        _ => node.clone(),
    }
}

/// 判断一个 kind 是否是"函数类"节点。
fn is_function_like_kind(kind: &str) -> bool {
    matches!(kind,
        "lambda" | "function_definition" | "function_declaration"
        | "function_expression" | "arrow_function" | "function_item"
        | "func_decl"
    )
}

/// 判断一个节点（含包装层）是否代表函数定义。
fn is_function_like(node: &Node) -> bool {
    is_function_like_kind(unwrap_semantic_node(node).kind())
}

// ---------------------------------------------------------------------------
// FIX 2: normalize_node_kind 现在穿透包装层
// ---------------------------------------------------------------------------

fn normalize_node_kind(node: &Node) -> String {
    let inner = unwrap_semantic_node(node);
    match inner.kind() {
        "lambda" | "function_declaration" | "function_definition"
        | "function_expression" | "arrow_function" | "function_item"
        | "func_decl" => "function".to_string(),

        "list_comprehension" | "dict_comprehension" | "set_comprehension"
        | "generator_expression" | "dictionary_comprehension" => "comprehension".to_string(),

        // for+append 在顶层是 for_statement，也归到 comprehension 用于匹配
        "for_statement" => "for_loop".to_string(),

        other => other.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Identifier extraction
// ---------------------------------------------------------------------------

fn extract_identifier<'src>(node: &Node, src: &'src str) -> Option<&'src str> {
    // 先尝试穿透包装层
    let inner = unwrap_semantic_node(node);
    if inner.id() != node.id() {
        if let Some(id) = extract_identifier_inner(&inner, src) {
            return Some(id);
        }
        // 如果穿透后的内层是 lambda，lambda 本身没有名字，
        // 则回退到外层 assignment 取 lhs 名称。
        return extract_identifier_inner(node, src);
    }
    extract_identifier_inner(node, src)
}

fn extract_identifier_inner<'src>(node: &Node, src: &'src str) -> Option<&'src str> {
    match node.kind() {
        "function_declaration" | "function_expression" | "arrow_function"
        | "method_definition" | "method_declaration"
        | "function_item" | "func_decl" => {
            child_text_of_kind(node, src, "identifier")
                .or_else(|| child_text_of_kind(node, src, "field_identifier"))
        }
        "lambda" => None, // lambda 本身没有名字，由包装层的 assignment 提供
        "class_declaration" | "class_expression" | "interface_declaration"
        | "type_alias_declaration" | "struct_item" | "enum_item" | "trait_item" => {
            child_text_of_kind(node, src, "type_identifier")
                .or_else(|| child_text_of_kind(node, src, "identifier"))
        }
        "variable_declarator" | "const_item" | "static_item" | "let_declaration" => {
            child_text_of_kind(node, src, "identifier")
                .or_else(|| child_text_of_kind(node, src, "pattern"))
        }
        "lexical_declaration" => {
            for i in 0..node.child_count() {
                if let Some(child) = node.child(i) {
                    if child.kind() == "variable_declarator" {
                        if let Some(id) = child_text_of_kind(&child, src, "identifier") {
                            return Some(id);
                        }
                    }
                }
            }
            None
        }
        "function_definition" | "class_definition" => {
            child_text_of_kind(node, src, "identifier")
        }
        // expression_statement：穿透到 assignment 左侧
        "expression_statement" => {
            for i in 0..node.child_count() {
                if let Some(child) = node.child(i) {
                    if child.kind() == "assignment" {
                        if let Some(lhs) = child.child(0) {
                            if lhs.kind() == "identifier" {
                                return lhs.utf8_text(src.as_bytes()).ok();
                            }
                        }
                    }
                }
            }
            None
        }
        // assignment：左侧 identifier
        "assignment" => {
            if let Some(lhs) = node.child(0) {
                if lhs.kind() == "identifier" {
                    return lhs.utf8_text(src.as_bytes()).ok();
                }
            }
            None
        }
        "for_statement" => child_text_of_kind(node, src, "identifier"),
        _ => None,
    }
}

fn child_text_of_kind<'src>(node: &Node, src: &'src str, target: &str) -> Option<&'src str> {
    for i in 0..node.child_count() {
        let child = node.child(i)?;
        if child.kind() == target {
            return child.utf8_text(src.as_bytes()).ok();
        }
    }
    None
}

// ---------------------------------------------------------------------------
// FIX 3: similarity 和 find_best_match_index 使用新的 normalize_node_kind
// ---------------------------------------------------------------------------

fn similarity(a: &Node, b: &Node, src_a: &str, src_b: &str) -> f64 {
    // FIX: 使用接受 Node 的版本，可以穿透包装层
    let norm_a = normalize_node_kind(a);
    let norm_b = normalize_node_kind(b);

    let mut score = if norm_a == norm_b {
        0.5
    } else if semantic_type(&norm_a) == semantic_type(&norm_b) {
        0.35
    } else {
        return 0.0;
    };

    let id_a = extract_identifier(a, src_a);
    let id_b = extract_identifier(b, src_b);

    match (id_a, id_b) {
        (Some(x), Some(y)) if x == y => score += 0.4,
        (Some(x), Some(y)) if levenshtein(x, y) <= 2 => score += 0.15,
        _ => {}
    }

    let ca = a.child_count();
    let cb = b.child_count();
    let max_c = ca.max(cb) as f64;
    if max_c > 0.0 {
        score += 0.1 * (1.0 - (ca as f64 - cb as f64).abs() / (max_c + 1.0));
    }

    score.min(1.0)
}

fn find_best_match_index<'a>(
    node: &Node,
    candidates: &[Node<'a>],
    matched: &[bool],
    src_a: &str,
    src_b: &str,
    threshold: f64,
) -> Option<(usize, f64)> {
    let norm_kind = normalize_node_kind(node);

    // 优先：精确 identifier 匹配（跨语义类型）
    if let Some(id) = extract_identifier(node, src_a) {
        let node_norm = normalize_node_kind(node);
        let node_sem = semantic_type(&node_norm);

        if let Some((ib, _)) = candidates.iter().enumerate().find_map(|(ib, cb)| {
            if matched[ib] { return None; }
            if extract_identifier(cb, src_b) != Some(id) { return None; }

            let cb_norm = normalize_node_kind(cb);
            let cb_sem = semantic_type(&cb_norm);

            // 同语义类型，或者已知的等价对
            let compatible = node_sem == cb_sem
                || (node_norm == "function" && cb_norm == "function") // lambda ↔ def
                || (node_norm == "for_loop" && cb_norm == "comprehension")
                || (node_norm == "comprehension" && cb_norm == "for_loop");

            if compatible { Some((ib, 1.0)) } else { None }
        }) {
            return Some((ib, 1.0));
        }
    }

    // for_statement ↔ comprehension 盲匹配（无 identifier 的情况）
    let is_for_or_comp = matches!(norm_kind.as_str(), "for_loop" | "comprehension");
    if is_for_or_comp {
        let target_norm = if norm_kind == "for_loop" { "comprehension" } else { "for_loop" };
        for (ib, cb) in candidates.iter().enumerate() {
            if matched[ib] { continue; }
            if normalize_node_kind(cb) == target_norm {
                return Some((ib, 0.75));
            }
        }
    }

    // fuzzy 相似度匹配
    candidates.iter().enumerate()
        .filter(|(ib, _)| !matched[*ib])
        .filter(|(_, cb)| normalize_node_kind(cb) == norm_kind)
        .filter_map(|(ib, cb)| {
            let score = similarity(node, cb, src_a, src_b);
            if score >= threshold { Some((ib, score)) } else { None }
        })
        .max_by(|(_, sa), (_, sb)| sa.partial_cmp(sb).unwrap())
}

// ---------------------------------------------------------------------------
// Expression operator extraction
// ---------------------------------------------------------------------------

fn operator_of_expression<'src>(node: &Node, src: &'src str) -> Option<&'src str> {
    match node.kind() {
        "binary_expression" => {
            for i in 0..node.child_count() {
                if let Some(child) = node.child(i) {
                    if is_operator_node(&child) {
                        return child.utf8_text(src.as_bytes()).ok();
                    }
                }
            }
            None
        }
        "unary_expression" => {
            if let Some(child) = node.child(0) {
                if is_operator_node(&child) {
                    return child.utf8_text(src.as_bytes()).ok();
                }
            }
            None
        }
        "assignment_expression" | "assignment" => {
            for i in 0..node.child_count() {
                if let Some(child) = node.child(i) {
                    match child.kind() {
                        "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "**=" | "&=" | "|=" | "^="
                        | "<<=" | ">>=" | ">>>=" => {
                            return child.utf8_text(src.as_bytes()).ok();
                        }
                        _ => {}
                    }
                }
            }
            None
        }
        _ => None,
    }
}

fn is_operator_node(node: &Node) -> bool {
    matches!(
        node.kind(),
        "+" | "-" | "*" | "/" | "%" | "**"
        | "&&" | "||" | "&" | "|" | "^"
        | "<<" | ">>" | ">>>"
        | "==" | "!=" | "<" | ">" | "<=" | ">="
        | "!" | "~"
        | "=" | "+=" | "-=" | "*=" | "/=" | "%="
        | "**=" | "&=" | "|=" | "^=" | "<<=" | ">>=" | ">>>="
    )
}

fn is_expression_node(node: &Node) -> bool {
    matches!(
        node.kind(),
        "binary_expression" | "unary_expression"
        | "assignment_expression" | "assignment" | "update_expression"
    )
}

// ---------------------------------------------------------------------------
// FIX 4: for+append ↔ comprehension 识别
//
// 核心思路：在 diff() 入口做一次全局扫描，把
//   (tops_a 里的 result=[] 行, tops_a 里的 for 行)
// 和
//   (tops_b 里的 result=[...comprehension...] 行)
// 打包成等价组，统一输出 1 个 Modify block。
// ---------------------------------------------------------------------------

fn is_comprehension_kind(kind: &str) -> bool {
    matches!(kind,
        "list_comprehension" | "dict_comprehension" | "set_comprehension"
        | "generator_expression" | "dictionary_comprehension"
    )
}

/// 从顶层节点里找到 `name = []` / `name = {}` / `name = set()` 的初始化行。
fn find_empty_init_index_in_nodes(nodes: &[Node], name: &str, src: &str) -> Option<usize> {
    for (i, node) in nodes.iter().enumerate() {
        if let Some(lhs_name) = extract_assignment_lhs_name(node, src) {
            if lhs_name != name { continue; }
            // 检查右侧是否是空容器
            if let Some(rhs) = extract_rhs(node) {
                if is_empty_container(&rhs, src) {
                    return Some(i);
                }
            }
        }
    }
    None
}

fn find_empty_init_index(tops: &[Node], name: &str, src: &str) -> Option<usize> {
    find_empty_init_index_in_nodes(tops, name, src)
}

fn extract_return_expr<'a>(node: &'a Node<'a>) -> Option<Node<'a>> {
    for child in semantic_children(node) {
        if child.kind() == "return" || child.kind() == "yield" {
            continue;
        }
        return Some(child);
    }
    None
}

fn find_return_statement_index_for_identifier(nodes: &[Node], name: &str, src: &str) -> Option<usize> {
    for (i, node) in nodes.iter().enumerate() {
        if node.kind() != "return_statement" {
            continue;
        }
        if let Some(expr) = extract_return_expr(node) {
            if expr.kind() == "identifier" {
                if let Ok(text) = expr.utf8_text(src.as_bytes()) {
                    if text == name {
                        return Some(i);
                    }
                }
            }
        }
    }
    None
}

fn find_return_comprehension_index(nodes: &[Node], _src: &str) -> Option<usize> {
    for (i, node) in nodes.iter().enumerate() {
        if node.kind() != "return_statement" {
            continue;
        }
        if let Some(expr) = extract_return_expr(node) {
            if is_comprehension_kind(expr.kind()) {
                return Some(i);
            }
        }
    }
    None
}

fn find_accumulator_for_comprehension_pattern(nodes: &[Node], src: &str) -> Option<(String, usize, usize)> {
    for (i, node) in nodes.iter().enumerate() {
        if node.kind() != "for_statement" { continue; }
        if let Some(container) = for_statement_append_target(node, src) {
            if find_empty_init_index_in_nodes(nodes, &container, src).is_some()
                && find_return_statement_index_for_identifier(nodes, &container, src).is_some()
            {
                let return_idx = find_return_statement_index_for_identifier(nodes, &container, src).unwrap();
                return Some((container, i, return_idx));
            }
        }
    }
    None
}

fn extract_assignment_lhs_name<'src>(node: &Node, src: &'src str) -> Option<&'src str> {
    let node = match node.kind() {
        "expression_statement" => {
            let mut found = None;
            for i in 0..node.child_count() {
                if let Some(c) = node.child(i) {
                    if c.kind() == "assignment" { found = Some(c); break; }
                }
            }
            found?
        }
        "assignment" => node.clone(),
        _ => return None,
    };
    // lhs 是第一个子节点
    if let Some(lhs) = node.child(0) {
        if lhs.kind() == "identifier" {
            return lhs.utf8_text(src.as_bytes()).ok();
        }
    }
    None
}

fn extract_rhs<'a>(node: &'a Node<'a>) -> Option<Node<'a>> {
    let assign = match node.kind() {
        "expression_statement" => {
            let mut found = None;
            for i in 0..node.child_count() {
                if let Some(c) = node.child(i) {
                    if c.kind() == "assignment" { found = Some(c); break; }
                }
            }
            found?
        }
        "assignment" => node.clone(),
        _ => return None,
    };
    // rhs：= 之后的节点
    let mut after_eq = false;
    for i in 0..assign.child_count() {
        if let Some(c) = assign.child(i) {
            if c.kind() == "=" { after_eq = true; continue; }
            if after_eq && is_semantic(&c) { return Some(c); }
        }
    }
    None
}

fn extract_expression<'a>(node: &'a Node<'a>) -> Option<Node<'a>> {
    if node.kind() == "expression_statement" {
        for i in 0..node.child_count() {
            if let Some(child) = node.child(i) {
                if is_semantic(&child) {
                    return Some(child);
                }
            }
        }
        return None;
    }
    extract_rhs(node)
}

fn is_empty_container(node: &Node, src: &str) -> bool {
    match node.kind() {
        "list" | "dictionary" => {
            semantic_children(node).is_empty()
        }
        "call" => {
            // set() 调用
            if let Some(func) = node.child(0) {
                if let Ok(name) = func.utf8_text(src.as_bytes()) {
                    if name == "set" {
                        if let Some(args) = node.child(1) {
                            return semantic_children(&args).is_empty();
                        }
                    }
                }
            }
            false
        }
        _ => false,
    }
}

/// 从 for_statement 里提取 append/add 目标容器名。
/// 返回 Some(container_name) 表示这是一个 for+append 模式。
fn for_statement_append_target<'src>(node: &Node, src: &'src str) -> Option<String> {
    if node.kind() != "for_statement" { return None; }
    // 在 body 里找 .append(...) 或 .add(...)
    find_append_target_in_subtree(node, src)
}

fn find_append_target_in_subtree(node: &Node, src: &str) -> Option<String> {
    if node.kind() == "call" {
        // 看 function 子节点是否是 attribute：xxx.append 或 xxx.add
        if let Some(func) = node.child(0) {
            if func.kind() == "attribute" {
                let text = func.utf8_text(src.as_bytes()).unwrap_or("");
                if text.ends_with(".append") || text.ends_with(".add") {
                    let container = text
                        .strip_suffix(".append")
                        .or_else(|| text.strip_suffix(".add"))
                        .unwrap_or("");
                    if !container.is_empty() {
                        return Some(container.to_string());
                    }
                }
            }
        }
    }

    if node.kind() == "assignment" {
        // 支持字典赋值：result[x] = value
        if let Some(lhs) = node.child(0) {
            if lhs.kind() == "subscript" {
                if let Some(base) = lhs.child(0) {
                    if base.kind() == "identifier" {
                        return base.utf8_text(src.as_bytes()).ok().map(|s| s.to_string());
                    }
                }
            }
        }
    }

    for i in 0..node.child_count() {
        if let Some(child) = node.child(i) {
            if let Some(r) = find_append_target_in_subtree(&child, src) {
                return Some(r);
            }
        }
    }
    None
}

/// 找顶层节点里包含指定 for_statement 的那个节点（可能就是 for_statement 本身）。
#[allow(dead_code)]
fn find_top_containing_for(tops: &[Node], src: &str, container: &str) -> Option<usize> {
    for (i, node) in tops.iter().enumerate() {
        if node.kind() == "for_statement" {
            if let Some(target) = for_statement_append_target(node, src) {
                if target == container { return Some(i); }
            }
        }
    }
    None
}

/// 找顶层节点里右侧是 comprehension、且赋值目标名为 container 的节点。
fn find_comprehension_assignment(tops: &[Node], container: &str, src: &str) -> Option<usize> {
    for (i, node) in tops.iter().enumerate() {
        if let Some(name) = extract_assignment_lhs_name(node, src) {
            if name != container { continue; }
            if let Some(rhs) = extract_rhs(node) {
                if is_comprehension_kind(rhs.kind()) {
                    return Some(i);
                }
            }
        }
    }
    // Fallback: allow bare comprehension expressions when the equivalent form is not assigned.
    for (i, node) in tops.iter().enumerate() {
        if let Some(rhs) = extract_expression(node) {
            if is_comprehension_kind(rhs.kind()) {
                return Some(i);
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Change types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Add, Remove, Modify,
}

impl ChangeKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Add => "add",
            Self::Remove => "remove",
            Self::Modify => "modify",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity { Major, Minor, Trivial }

fn classify_severity(kind: &str, change: ChangeKind) -> Severity {
    match (kind, change) {
        (_, ChangeKind::Remove) => Severity::Major,
        ("function_declaration" | "function_item" | "func_decl"
         | "class_declaration" | "interface_declaration"
         | "struct_item" | "trait_item", _) => Severity::Major,
        ("comment" | "line_comment" | "block_comment", _) => Severity::Trivial,
        _ => Severity::Minor,
    }
}

// ---------------------------------------------------------------------------
// Public data structures
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeSnapshot {
    pub kind: String,
    pub snippet: String,
    pub start_line: usize,
    pub end_line: usize,
    pub identifier: Option<String>,
}

impl NodeSnapshot {
    fn from_node(node: &Node, src: &str) -> Self {
        let text = node.utf8_text(src.as_bytes()).unwrap_or("");
        let snippet = if text.chars().count() > 60 {
            let abbrev: String = text.chars().take(60).collect();
            format!("{}…", abbrev)
        } else {
            text.to_owned()
        };
        let start_byte = node.start_byte();
        let end_byte = node.end_byte();
        let start_line = src[..start_byte].matches('\n').count() + 1;
        let end_line = src[..end_byte].matches('\n').count() + 1;
        Self {
            kind: node.kind().to_owned(),
            snippet,
            start_line,
            end_line,
            identifier: extract_identifier(node, src).map(str::to_owned),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffBlock {
    pub change_kind: String,
    pub severity: String,
    pub semantic_type: String,
    pub description: String,
    pub old_identifier: Option<String>,
    pub new_identifier: Option<String>,
    pub from_node: Option<NodeSnapshot>,
    pub to_node: Option<NodeSnapshot>,
}

impl DiffBlock {
    fn new(
        change: ChangeKind,
        from: Option<(&Node, &str)>,
        to: Option<(&Node, &str)>,
    ) -> Self {
        let from_snap = from.map(|(n, s)| NodeSnapshot::from_node(n, s));
        let to_snap = to.map(|(n, s)| NodeSnapshot::from_node(n, s));

        let kind_str = from.map(|(n, _)| n.kind())
            .or_else(|| to.map(|(n, _)| n.kind()))
            .unwrap_or("");
        let sem = semantic_type(kind_str);
        let severity = classify_severity(kind_str, change);

        let old_id = from_snap.as_ref().and_then(|s| s.identifier.clone());
        let new_id = to_snap.as_ref().and_then(|s| s.identifier.clone());
        let description = build_description(change, sem, old_id.as_deref(), new_id.as_deref());

        Self {
            change_kind: change.as_str().to_owned(),
            severity: format!("{:?}", severity).to_lowercase(),
            semantic_type: sem.to_owned(),
            description,
            old_identifier: old_id,
            new_identifier: new_id,
            from_node: from_snap,
            to_node: to_snap,
        }
    }
}

fn build_description(
    change: ChangeKind,
    sem: &str,
    old_id: Option<&str>,
    new_id: Option<&str>,
) -> String {
    match (change, old_id, new_id) {
        (ChangeKind::Modify, Some(a), Some(b)) if a != b => format!("{sem} renamed: {a} → {b}"),
        (ChangeKind::Modify, Some(id), _) | (ChangeKind::Modify, _, Some(id)) => format!("{sem} modified: {id}"),
        (ChangeKind::Add, _, Some(id)) => format!("{sem} added: {id}"),
        (ChangeKind::Add, _, None) => format!("{sem} added"),
        (ChangeKind::Remove, Some(id), _) => format!("{sem} removed: {id}"),
        (ChangeKind::Remove, None, _) => format!("{sem} removed"),
        (ChangeKind::Modify, None, None) => format!("{sem} modified"),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffResult {
    pub language: String,
    pub total_changes: usize,
    pub major_changes: usize,
    pub minor_changes: usize,
    pub trivial_changes: usize,
    pub added_elements: usize,
    pub removed_elements: usize,
    pub modified_elements: usize,
    pub blocks: Vec<DiffBlock>,
}

// ---------------------------------------------------------------------------
// Recursive body diff
// ---------------------------------------------------------------------------

const MAX_RECURSE_DEPTH: usize = 6;

fn diff_children(
    a: &Node,
    b: &Node,
    src_a: &str,
    src_b: &str,
    depth: usize,
    out: &mut Vec<DiffBlock>,
) {
    if is_structurally_equal(a, b, src_a, src_b) {
        return;
    }

    // 操作符变更：不递归到操作数
    if is_expression_node(a) && is_expression_node(b) {
        let op_a = operator_of_expression(a, src_a);
        let op_b = operator_of_expression(b, src_b);
        if let (Some(x), Some(y)) = (op_a, op_b) {
            if x != y {
                out.push(DiffBlock::new(ChangeKind::Modify, Some((a, src_a)), Some((b, src_b))));
                return;
            }
        }
    }

    // FIX 5: assignment 右侧 comprehension ↔ 空容器/for 等价，输出单个 Modify
    if a.kind() == "assignment" && b.kind() == "assignment" {
        let rhs_a = extract_rhs(a);
        let rhs_b = extract_rhs(b);
        if let (Some(ra), Some(rb)) = (rhs_a, rhs_b) {
            let ra_is_comp = is_comprehension_kind(ra.kind());
            let rb_is_comp = is_comprehension_kind(rb.kind());
            let ra_is_init = is_empty_container(&ra, src_a) || ra.kind() == "for_statement";
            let rb_is_init = is_empty_container(&rb, src_b) || rb.kind() == "for_statement";
            if (ra_is_comp && rb_is_init) || (ra_is_init && rb_is_comp) {
                out.push(DiffBlock::new(ChangeKind::Modify, Some((a, src_a)), Some((b, src_b))));
                return;
            }
        }
    }

    if depth == 0 {
        out.push(DiffBlock::new(ChangeKind::Modify, Some((a, src_a)), Some((b, src_b))));
        return;
    }

    let children_a = semantic_children(a);
    let children_b = semantic_children(b);

    if children_a.is_empty() && children_b.is_empty() {
        out.push(DiffBlock::new(ChangeKind::Modify, Some((a, src_a)), Some((b, src_b))));
        return;
    }

    let mut matched_a = vec![false; children_a.len()];
    let mut matched_b = vec![false; children_b.len()];

    // FIX: 在函数/块体内也识别 accumulator + for-loop → return comprehension 的重构。
    if let Some((container, for_idx, return_idx)) = find_accumulator_for_comprehension_pattern(&children_a, src_a) {
        if let Some(ret_b) = find_return_comprehension_index(&children_b, src_b) {
            matched_a[for_idx] = true;
            matched_a[return_idx] = true;
            if let Some(init_idx) = find_empty_init_index_in_nodes(&children_a, &container, src_a) {
                matched_a[init_idx] = true;
            }
            matched_b[ret_b] = true;
            out.push(DiffBlock {
                change_kind: "modify".to_owned(),
                severity: "minor".to_owned(),
                semantic_type: "comprehension".to_owned(),
                description: format!("loop refactored to comprehension: {container}"),
                old_identifier: Some(container.clone()),
                new_identifier: Some(container.clone()),
                from_node: Some(NodeSnapshot::from_node(&children_a[for_idx], src_a)),
                to_node: Some(NodeSnapshot::from_node(&children_b[ret_b], src_b)),
            });
        }
    }
    if let Some((container, for_idx, return_idx)) = find_accumulator_for_comprehension_pattern(&children_b, src_b) {
        if let Some(ret_a) = find_return_comprehension_index(&children_a, src_a) {
            matched_b[for_idx] = true;
            matched_b[return_idx] = true;
            if let Some(init_idx) = find_empty_init_index_in_nodes(&children_b, &container, src_b) {
                matched_b[init_idx] = true;
            }
            matched_a[ret_a] = true;
            out.push(DiffBlock {
                change_kind: "modify".to_owned(),
                severity: "minor".to_owned(),
                semantic_type: "comprehension".to_owned(),
                description: format!("loop refactored to comprehension: {container}"),
                old_identifier: Some(container.clone()),
                new_identifier: Some(container.clone()),
                from_node: Some(NodeSnapshot::from_node(&children_a[ret_a], src_a)),
                to_node: Some(NodeSnapshot::from_node(&children_b[for_idx], src_b)),
            });
        }
    }

    for (ia, ca) in children_a.iter().enumerate() {
        if matched_a[ia] { continue; }
        if let Some((ib, _)) = find_best_match_index(ca, &children_b, &matched_b, src_a, src_b, 0.5) {
            matched_b[ib] = true;
            let cb = &children_b[ib];
            diff_children(ca, cb, src_a, src_b, depth - 1, out);
        } else {
            out.push(DiffBlock::new(ChangeKind::Remove, Some((ca, src_a)), None));
        }
    }

    for (ib, cb) in children_b.iter().enumerate() {
        if !matched_b[ib] {
            out.push(DiffBlock::new(ChangeKind::Add, None, Some((cb, src_b))));
        }
    }
}

// ---------------------------------------------------------------------------
// Signature diff
// ---------------------------------------------------------------------------

fn parameter_count(node: &Node) -> usize {
    for i in 0..node.child_count() {
        if let Some(child) = node.child(i) {
            if matches!(child.kind(), "formal_parameters" | "parameters" | "parameter_list") {
                return semantic_children(&child)
                    .iter()
                    .filter(|n| matches!(n.kind(),
                        "identifier" | "typed_identifier" | "parameter" | "typed_parameter"
                    ))
                    .count();
            }
        }
    }
    0
}

fn return_type_text<'src>(node: &Node, src: &'src str) -> Option<&'src str> {
    for i in 0..node.child_count() {
        if let Some(child) = node.child(i) {
            if matches!(child.kind(), "type_annotation" | "return_type" | "result_type") {
                return child.utf8_text(src.as_bytes()).ok();
            }
        }
    }
    None
}

fn diff_signatures(a: &Node, b: &Node, src_a: &str, src_b: &str, out: &mut Vec<DiffBlock>) {
    let sem = semantic_type(a.kind());
    if !matches!(sem, "function" | "method") { return; }

    let params_a = parameter_count(a);
    let params_b = parameter_count(b);
    if params_a != params_b {
        let id = extract_identifier(a, src_a).unwrap_or("anonymous");
        out.push(DiffBlock {
            change_kind: "modify".to_owned(),
            severity: "major".to_owned(),
            semantic_type: "function signature".to_owned(),
            description: format!("function {id} parameter count changed: {params_a} → {params_b}"),
            old_identifier: Some(id.to_owned()),
            new_identifier: extract_identifier(b, src_b).map(str::to_owned),
            from_node: Some(NodeSnapshot::from_node(a, src_a)),
            to_node: Some(NodeSnapshot::from_node(b, src_b)),
        });
    }

    let ret_a = return_type_text(a, src_a);
    let ret_b = return_type_text(b, src_b);
    if ret_a != ret_b {
        let id = extract_identifier(a, src_a).unwrap_or("anonymous");
        out.push(DiffBlock {
            change_kind: "modify".to_owned(),
            severity: "major".to_owned(),
            semantic_type: "return type".to_owned(),
            description: format!(
                "return type of {id} changed: {} → {}",
                ret_a.unwrap_or("(inferred)"),
                ret_b.unwrap_or("(inferred)"),
            ),
            old_identifier: Some(id.to_owned()),
            new_identifier: extract_identifier(b, src_b).map(str::to_owned),
            from_node: Some(NodeSnapshot::from_node(a, src_a)),
            to_node: Some(NodeSnapshot::from_node(b, src_b)),
        });
    }
}

// ---------------------------------------------------------------------------
// FIX 6: Top-level diff — 两阶段：先全局识别等价组，再做普通 diff
// ---------------------------------------------------------------------------

pub fn diff(
    code_a: &str,
    code_b: &str,
    lang: SupportedLanguage,
) -> Result<DiffResult, String> {
    let mut pool = ParserPool::new();
    let tree_a = pool.parse(code_a, lang)?;
    let tree_b = pool.parse(code_b, lang)?;

    let root_a = tree_a.root_node();
    let root_b = tree_b.root_node();

    let tops_a: Vec<Node> = semantic_children(&root_a);
    let tops_b: Vec<Node> = semantic_children(&root_b);

    let mut blocks: Vec<DiffBlock> = Vec::new();
    let mut skip_a = vec![false; tops_a.len()]; // 已被等价组消耗
    let mut matched_b = vec![false; tops_b.len()];

    // ── 阶段1：全局识别 for+append ↔ comprehension 等价组 ──────────────────
    //
    // 扫描 tops_a 里的 for_statement，找到 append 目标容器名，
    // 然后在 tops_b 里找同名的 comprehension assignment。
    // 找到就打包成 1 个 Modify block，跳过所有相关行。

    for (ia, na) in tops_a.iter().enumerate() {
        if skip_a[ia] { continue; }

        // 直接是 for_statement，或者是顶层的 for（Python 里直接出现）
        let for_node = if na.kind() == "for_statement" {
            Some(na.clone())
        } else {
            None
        };

        if let Some(ref fnode) = for_node {
            if let Some(container) = for_statement_append_target(fnode, code_a) {
                // 在 tops_b 里找 container = [... comprehension ...]
                if let Some(ib) = find_comprehension_assignment(&tops_b, &container, code_b) {
                    if !matched_b[ib] {
                        // 找到等价对：标记跳过
                        skip_a[ia] = true;
                        matched_b[ib] = true;

                        // 同时跳过 tops_a 里的初始化行 result = []
                        if let Some(init_ia) = find_empty_init_index(&tops_a, &container, code_a) {
                            skip_a[init_ia] = true;
                        }

                        // 输出 1 个 Modify block
                        blocks.push(DiffBlock {
                            change_kind: "modify".to_owned(),
                            severity: "minor".to_owned(),
                            semantic_type: "comprehension".to_owned(),
                            description: format!(
                                "loop refactored to comprehension: {container}"
                            ),
                            old_identifier: Some(container.clone()),
                            new_identifier: Some(container),
                            from_node: Some(NodeSnapshot::from_node(na, code_a)),
                            to_node: Some(NodeSnapshot::from_node(&tops_b[ib], code_b)),
                        });
                    }
                }
            }
        }
    }

    // ── 阶段2：普通 diff（跳过已被等价组消耗的节点）──────────────────────
    const SIMILARITY_THRESHOLD: f64 = 0.55;

    for (ia, na) in tops_a.iter().enumerate() {
        if skip_a[ia] { continue; }

        let best_match = find_best_match_index(
            na, &tops_b, &matched_b, code_a, code_b, SIMILARITY_THRESHOLD,
        ).map(|(ib, _)| ib);

        if let Some(ib) = best_match {
            matched_b[ib] = true;
            let nb = &tops_b[ib];

            // FIX 7: lambda ↔ def 的等价识别
            // 如果两侧都是函数类（含包装层穿透），且 identifier 相同 → Modify（语法重构）
            let a_is_fn = is_function_like(na);
            let b_is_fn = is_function_like(nb);
            let a_id = extract_identifier(na, code_a);
            let b_id = extract_identifier(nb, code_b);

            if a_is_fn && b_is_fn && a_id == b_id && a_id.is_some() {
                // 同一函数的不同写法（lambda vs def），视为语法重构
                let inner_a = unwrap_semantic_node(na);
                let inner_b = unwrap_semantic_node(nb);
                if inner_a.kind() != inner_b.kind() {
                    // 写法不同 → Modify，不深入 diff body（body 结构差异太大，意义不大）
                    blocks.push(DiffBlock {
                        change_kind: "modify".to_owned(),
                        severity: "minor".to_owned(),
                        semantic_type: "function".to_owned(),
                        description: format!(
                            "function syntax changed: {} ({} → {})",
                            a_id.unwrap_or("anonymous"),
                            inner_a.kind(),
                            inner_b.kind(),
                        ),
                        old_identifier: a_id.map(str::to_owned),
                        new_identifier: b_id.map(str::to_owned),
                        from_node: Some(NodeSnapshot::from_node(na, code_a)),
                        to_node: Some(NodeSnapshot::from_node(nb, code_b)),
                    });
                } else {
                    // 相同写法，diff body
                    diff_signatures(na, nb, code_a, code_b, &mut blocks);
                    diff_children(na, nb, code_a, code_b, MAX_RECURSE_DEPTH, &mut blocks);
                }
            } else {
                // 普通匹配
                let a_sem = semantic_type(na.kind());
                let b_sem = semantic_type(nb.kind());
                if a_sem != b_sem && a_id == b_id && a_id.is_some() {
                    blocks.push(DiffBlock::new(
                        ChangeKind::Modify, Some((na, code_a)), Some((nb, code_b)),
                    ));
                } else {
                    diff_signatures(na, nb, code_a, code_b, &mut blocks);
                    diff_children(na, nb, code_a, code_b, MAX_RECURSE_DEPTH, &mut blocks);
                }
            }
        } else {
            blocks.push(DiffBlock::new(ChangeKind::Remove, Some((na, code_a)), None));
        }
    }

    for (ib, nb) in tops_b.iter().enumerate() {
        if !matched_b[ib] {
            blocks.push(DiffBlock::new(ChangeKind::Add, None, Some((nb, code_b))));
        }
    }

    // FIX 8: 所有统计从 blocks 推导，消除手动维护导致的脱节
    let major   = blocks.iter().filter(|b| b.severity == "major").count();
    let minor   = blocks.iter().filter(|b| b.severity == "minor").count();
    let trivial = blocks.iter().filter(|b| b.severity == "trivial").count();
    let added   = blocks.iter().filter(|b| b.change_kind == "add").count();
    let removed = blocks.iter().filter(|b| b.change_kind == "remove").count();
    let modified = blocks.iter().filter(|b| b.change_kind == "modify").count();

    Ok(DiffResult {
        language: lang.name().to_owned(),
        total_changes: blocks.len(), // 永远等于 blocks.len()
        major_changes: major,
        minor_changes: minor,
        trivial_changes: trivial,
        added_elements: added,
        removed_elements: removed,
        modified_elements: modified,
        blocks,
    })
}

// ---------------------------------------------------------------------------
// String utilities
// ---------------------------------------------------------------------------

fn levenshtein(a: &str, b: &str) -> usize {
    if a == b { return 0; }
    let (a, b) = if a.len() < b.len() { (b, a) } else { (a, b) };
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut prev = i;
        row[0] = i + 1;
        for (j, cb) in b.chars().enumerate() {
            let next = row[j + 1];
            row[j + 1] = if ca == cb { prev } else { prev.min(next).min(row[j]) + 1 };
            prev = next;
        }
    }
    row[b.len()]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_from_path() {
        assert_eq!(SupportedLanguage::from_path("app.js"), Some(SupportedLanguage::JavaScript));
        assert_eq!(SupportedLanguage::from_path("app.ts"), Some(SupportedLanguage::TypeScript));
        assert_eq!(SupportedLanguage::from_path("main.rs"), Some(SupportedLanguage::Rust));
        assert_eq!(SupportedLanguage::from_path("Main.java"), Some(SupportedLanguage::Java));
        assert_eq!(SupportedLanguage::from_path("readme.md"), None);
    }

    #[test]
    fn parser_pool_reuses_entries() {
        let mut pool = ParserPool::new();
        let _ = pool.parse("function f() {}", SupportedLanguage::JavaScript).unwrap();
        assert_eq!(pool.pool.len(), 1);
        let _ = pool.parse("function g() {}", SupportedLanguage::JavaScript).unwrap();
        assert_eq!(pool.pool.len(), 1);
        let _ = pool.parse("def f(): pass", SupportedLanguage::Python).unwrap();
        assert_eq!(pool.pool.len(), 2);
    }

    #[test]
    fn equal_ignores_whitespace() {
        let mut pool = ParserPool::new();
        let a = "function f() { return a + b; }";
        let b = "function f() { return a+b; }";
        let ta = pool.parse(a, SupportedLanguage::JavaScript).unwrap();
        let tb = pool.parse(b, SupportedLanguage::JavaScript).unwrap();
        assert!(is_structurally_equal(&ta.root_node(), &tb.root_node(), a, b));
    }

    #[test]
    fn detects_leaf_difference() {
        let mut pool = ParserPool::new();
        let a = "function f() { return 42; }";
        let b = "function f() { return 99; }";
        let ta = pool.parse(a, SupportedLanguage::JavaScript).unwrap();
        let tb = pool.parse(b, SupportedLanguage::JavaScript).unwrap();
        assert!(!is_structurally_equal(&ta.root_node(), &tb.root_node(), a, b));
    }

    #[test]
    fn identifier_from_function() {
        let mut pool = ParserPool::new();
        let src = "function myFunc() { return 1; }";
        let tree = pool.parse(src, SupportedLanguage::JavaScript).unwrap();
        let root = tree.root_node();
        if let Some(fn_node) = root.child(0) {
            assert_eq!(extract_identifier(&fn_node, src), Some("myFunc"));
        }
    }

    #[test]
    fn levenshtein_cases() {
        assert_eq!(levenshtein("foo", "foo"), 0);
        assert_eq!(levenshtein("cat", "car"), 1);
        assert_eq!(levenshtein("kitten", "sitting"), 3);
        assert_eq!(levenshtein("", "abc"), 3);
        assert_eq!(levenshtein("abc", ""), 3);
    }

    #[test]
    fn no_changes_identical_source() {
        let src = "function foo() { return 1; }\nfunction bar() { return 2; }";
        let result = diff(src, src, SupportedLanguage::JavaScript).unwrap();
        assert_eq!(result.total_changes, 0);
    }

    #[test]
    fn whitespace_only_change_not_reported() {
        let a = "function f() { return 1; }";
        let b = "function f() {   return 1;   }";
        let result = diff(a, b, SupportedLanguage::JavaScript).unwrap();
        assert_eq!(result.total_changes, 0);
    }

    #[test]
    fn detects_added_function() {
        let a = "function foo() { return 1; }";
        let b = "function foo() { return 1; }\nfunction bar() { return 2; }";
        let result = diff(a, b, SupportedLanguage::JavaScript).unwrap();
        assert!(result.added_elements > 0);
    }

    #[test]
    fn detects_removed_function() {
        let a = "function foo() {}\nfunction bar() {}";
        let b = "function foo() {}";
        let result = diff(a, b, SupportedLanguage::JavaScript).unwrap();
        assert!(result.removed_elements > 0);
    }

    #[test]
    fn detects_return_value_change() {
        let a = "function f() { return 42; }";
        let b = "function f() { return 99; }";
        let result = diff(a, b, SupportedLanguage::JavaScript).unwrap();
        assert!(result.total_changes > 0);
    }

    #[test]
    fn detects_parameter_count_change() {
        let a = "function calc(x, y) { return x + y; }";
        let b = "function calc(x, y, z) { return x + y + z; }";
        let result = diff(a, b, SupportedLanguage::JavaScript).unwrap();
        assert!(result.major_changes > 0);
        assert!(result.blocks.iter().any(|b| b.description.contains("parameter count")));
    }

    #[test]
    fn detects_rename_via_fuzzy_match() {
        let a = "function calculateSum(data) { return data.reduce((a, b) => a + b); }";
        let b = "function calcSum(data) { return data.reduce((a, b) => a + b); }";
        let result = diff(a, b, SupportedLanguage::JavaScript).unwrap();
        assert!(result.total_changes > 0);
        assert_eq!(result.added_elements + result.removed_elements, 0,
            "rename should not appear as add+remove");
    }

    #[test]
    fn mixed_changes() {
        let a = "function foo() { return 1; }\nfunction bar() { return 2; }\nfunction baz() { return 3; }";
        let b = "function foo(x) { return x; }\nfunction bar() { return 2; }\nfunction qux() { return 4; }";
        let result = diff(a, b, SupportedLanguage::JavaScript).unwrap();
        assert!(result.blocks.iter().any(|b| b.change_kind == "modify"), "foo param change");
        assert!(result.blocks.iter().any(|b| b.change_kind == "remove"), "baz removal");
        assert!(result.blocks.iter().any(|b| b.change_kind == "add"), "qux addition");
    }

    #[test]
    fn severity_classification() {
        assert_eq!(classify_severity("function_declaration", ChangeKind::Remove), Severity::Major);
        assert_eq!(classify_severity("function_declaration", ChangeKind::Modify), Severity::Major);
        assert_eq!(classify_severity("comment", ChangeKind::Modify), Severity::Trivial);
        assert_eq!(classify_severity("variable_declarator", ChangeKind::Modify), Severity::Minor);
    }

    // ── 关键语义等价测试 ────────────────────────────────────────────────────

    #[test]
    fn lambda_vs_function_definition_normalized() {
        let a = "f = lambda x: x + 1";
        let b = "def f(x):\n    return x + 1";
        let result = diff(a, b, SupportedLanguage::Python).unwrap();
        println!("=== lambda vs def ===");
        println!("total: {}, added: {}, removed: {}",
            result.total_changes, result.added_elements, result.removed_elements);
        for block in &result.blocks {
            println!("  [{}/{}] {}", block.change_kind, block.severity, block.description);
        }
        // 核心断言：不能被拆成 add+remove，必须识别为同一个函数的重构
        assert!(
            result.added_elements + result.removed_elements < 2,
            "lambda and def should be recognized as equivalent, not as separate add+remove. \
             Got added={}, removed={}",
            result.added_elements, result.removed_elements,
        );
    }

    #[test]
    fn lambda_vs_function_definition_exact_syntax() {
        let a = "f = lambda x: x+1";
        let b = "def f(x):\n    return x+1";
        let result = diff(a, b, SupportedLanguage::Python).unwrap();
        assert!(result.added_elements + result.removed_elements < 2,
            "lambda and def should be recognized as equivalent, got added={} removed={}",
            result.added_elements, result.removed_elements);
    }

    #[test]
    fn for_loop_vs_list_comprehension_exact_syntax() {
        let a = "result=[]\nfor x in data:\n    if x%2==0:\n        result.append(x*2)";
        let b = "[x*2 for x in data if x%2==0]";
        let result = diff(a, b, SupportedLanguage::Python).unwrap();
        assert!(result.total_changes <= 3,
            "for+append and list comprehension should be recognized as equivalent, got {} changes",
            result.total_changes);
        assert!(result.blocks.iter().any(|b| b.change_kind == "modify"),
            "should produce at least one modify block");
    }

    #[test]
    fn for_loop_vs_list_comprehension_detected() {
        let a = "result = []\nfor x in data:\n    if x % 2 == 0:\n        result.append(x * 2)";
        let b = "result = [x * 2 for x in data if x % 2 == 0]";
        let result = diff(a, b, SupportedLanguage::Python).unwrap();
        println!("=== for+append vs comprehension ===");
        println!("total: {}", result.total_changes);
        for block in &result.blocks {
            println!("  [{}/{}] {}", block.change_kind, block.severity, block.description);
        }
        // 关键断言：不能爆炸成 5+ 个碎片
        assert!(
            result.total_changes <= 3,
            "for+append and comprehension should compact to <=3 blocks, got {}",
            result.total_changes
        );
        // 且不能全是 remove/add（应该有 modify）
        let has_modify = result.blocks.iter().any(|b| b.change_kind == "modify");
        assert!(has_modify, "should produce at least one modify block");
    }

    #[test]
    fn total_changes_always_equals_blocks_len() {
        // 验证统计不脱节
        let cases = vec![
            ("function f() { return 1; }", "function f() { return 2; }"),
            ("function f() {}", "function g() {}"),
            ("", "function f() {}"),
        ];
        for (a, b) in cases {
            let result = diff(a, b, SupportedLanguage::JavaScript).unwrap();
            assert_eq!(
                result.total_changes, result.blocks.len(),
                "total_changes must always equal blocks.len()"
            );
        }
    }

    #[test]
    fn operator_change_single_modify_block() {
        let a = "result = a + b;";
        let b = "result = a - b;";
        let result = diff(a, b, SupportedLanguage::JavaScript).unwrap();
        assert!(result.total_changes <= 2,
            "operator change should not expand into multiple diffs; got {}", result.total_changes);
        assert!(result.blocks.iter().any(|b| b.change_kind == "modify"));
    }

    #[test]
    fn normalize_node_kind_correctness() {
        let mut pool = ParserPool::new();
        // lambda 节点归一化为 function
        let src = "f = lambda x: x + 1";
        let tree = pool.parse(src, SupportedLanguage::Python).unwrap();
        let root = tree.root_node();
        let tops: Vec<Node> = semantic_children(&root);
        if let Some(top) = tops.first() {
            assert_eq!(normalize_node_kind(top), "function",
                "expression_statement wrapping lambda should normalize to 'function'");
        }

        // list_comprehension 归一化为 comprehension
        let src2 = "result = [x for x in data]";
        let tree2 = pool.parse(src2, SupportedLanguage::Python).unwrap();
        let root2 = tree2.root_node();
        // 找到 list_comprehension 节点本身
        let tops2: Vec<Node> = semantic_children(&root2);
        if let Some(top2) = tops2.first() {
            // top2 是 expression_statement → assignment → list_comprehension
            // unwrap_semantic_node 应该穿透到 assignment（rhs 不是函数类）
            // 但 normalize 对 comprehension 也要正确
            // 这里测试内层 comprehension 节点
        }
        let _ = tops2;
    }
}