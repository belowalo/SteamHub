//! Bounded text KeyValues parser. No includes, scripts, or filesystem access.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Text(String),
    Object(Vec<(String, Value)>),
}
impl Value {
    pub fn text(&self) -> Result<&str, String> {
        match self {
            Self::Text(value) => Ok(value),
            _ => Err("Expected text value".into()),
        }
    }
    pub fn object(&self) -> Result<&[(String, Value)], String> {
        match self {
            Self::Object(value) => Ok(value),
            _ => Err("Expected object".into()),
        }
    }
}
pub fn field<'a>(pairs: &'a [(String, Value)], key: &str) -> Result<Option<&'a Value>, String> {
    let mut values = pairs
        .iter()
        .filter(|(name, _)| name.eq_ignore_ascii_case(key));
    let value = values.next().map(|(_, value)| value);
    if values.next().is_some() {
        return Err(format!("Duplicate {key} field"));
    }
    Ok(value)
}
pub fn required<'a>(pairs: &'a [(String, Value)], key: &str) -> Result<&'a str, String> {
    field(pairs, key)?
        .ok_or_else(|| format!("Missing {key} field"))?
        .text()
}

struct Parser<'a> {
    chars: std::iter::Peekable<std::str::Chars<'a>>,
    tokens: usize,
}
#[derive(Debug, PartialEq)]
enum Token {
    Text(String),
    Open,
    Close,
}
impl Parser<'_> {
    fn next(&mut self) -> Result<Option<Token>, String> {
        loop {
            while self
                .chars
                .peek()
                .is_some_and(|c| c.is_whitespace() || *c == '\u{feff}')
            {
                self.chars.next();
            }
            if self.chars.peek() != Some(&'/') {
                break;
            }
            let mut probe = self.chars.clone();
            probe.next();
            match probe.next() {
                Some('/') => {
                    self.chars.next();
                    self.chars.next();
                    for c in self.chars.by_ref() {
                        if c == '\n' {
                            break;
                        }
                    }
                }
                Some('*') => {
                    self.chars.next();
                    self.chars.next();
                    let mut previous = '\0';
                    let mut closed = false;
                    for c in self.chars.by_ref() {
                        if previous == '*' && c == '/' {
                            closed = true;
                            break;
                        }
                        previous = c;
                    }
                    if !closed {
                        return Err("Unclosed comment".into());
                    }
                }
                _ => break,
            }
        }
        let Some(first) = self.chars.next() else {
            return Ok(None);
        };
        self.tokens += 1;
        if self.tokens > 200_000 {
            return Err("Token limit exceeded".into());
        }
        match first {
            '{' => Ok(Some(Token::Open)),
            '}' => Ok(Some(Token::Close)),
            '"' => {
                let mut text = String::new();
                while let Some(c) = self.chars.next() {
                    match c {
                        '"' => return Ok(Some(Token::Text(text))),
                        '\\' => match self.chars.next().ok_or("Unclosed escape")? {
                            '"' => text.push('"'),
                            '\\' => text.push('\\'),
                            'n' => text.push('\n'),
                            'r' => text.push('\r'),
                            't' => text.push('\t'),
                            unknown => {
                                text.push('\\');
                                text.push(unknown);
                            }
                        },
                        '\0' => return Err("NUL in text".into()),
                        _ => text.push(c),
                    }
                }
                Err("Unclosed string".into())
            }
            '\0' => Err("NUL in text".into()),
            _ => {
                let mut text = String::from(first);
                while self
                    .chars
                    .peek()
                    .is_some_and(|c| !c.is_whitespace() && *c != '{' && *c != '}')
                {
                    text.push(self.chars.next().unwrap());
                }
                if text.starts_with('#') || text.starts_with('[') {
                    return Err("Directives and conditionals are unsupported".into());
                }
                Ok(Some(Token::Text(text)))
            }
        }
    }
    fn pairs(&mut self, nested: bool, depth: usize) -> Result<Vec<(String, Value)>, String> {
        if depth > 64 {
            return Err("Nesting limit exceeded".into());
        }
        let mut result = Vec::new();
        loop {
            let key = match self.next()? {
                Some(Token::Text(key)) => key,
                Some(Token::Close) if nested => return Ok(result),
                None if !nested => return Ok(result),
                _ => return Err("Unexpected brace or end of input".into()),
            };
            let value = match self.next()? {
                Some(Token::Text(text)) => Value::Text(text),
                Some(Token::Open) => Value::Object(self.pairs(true, depth + 1)?),
                _ => return Err("Missing value".into()),
            };
            result.push((key, value));
        }
    }
}
pub fn parse(input: &str) -> Result<Vec<(String, Value)>, String> {
    if input.len() > 2 * 1024 * 1024 {
        return Err("Input limit exceeded".into());
    }
    Parser {
        chars: input.chars().peekable(),
        tokens: 0,
    }
    .pairs(false, 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn provided_vdf_and_acf() {
        let folders = parse(include_str!("../../../../fixtures/libraryfolders.vdf")).unwrap();
        let entries = field(&folders, "libraryfolders")
            .unwrap()
            .unwrap()
            .object()
            .unwrap();
        assert_eq!(
            required(entries[0].1.object().unwrap(), "path").unwrap(),
            "C:\\Program Files (x86)\\Steam"
        );
        let acf = parse(include_str!(
            "../../../../fixtures/appmanifest_999999991.acf"
        ))
        .unwrap();
        assert_eq!(
            required(acf[0].1.object().unwrap(), "appid").unwrap(),
            "999999991"
        );
    }
    #[test]
    fn comments_escaped_strings_and_unquoted_tokens() {
        let parsed = parse("\u{feff}// comment\nLibraryFolders { 0 \"C:\\\\Games \\\"quoted\\\"\\\\Steam\" /*comment*/ 1 \"D:\\Steam\" }").unwrap();
        let entries = parsed[0].1.object().unwrap();
        assert_eq!(entries[0].1.text().unwrap(), "C:\\Games \"quoted\"\\Steam");
        assert_eq!(entries[1].1.text().unwrap(), "D:\\Steam");
    }
    #[test]
    fn rejects_malformed_duplicate_sensitive_fields_and_limits() {
        for input in [
            "a {",
            "a",
            "a \"unterminated",
            "}",
            "#include secret",
            "/* open",
            "a { b }",
        ] {
            assert!(parse(input).is_err(), "{input}");
        }
        assert!(field(&parse("appid 1 AppID 2").unwrap(), "appid").is_err());
        assert!(parse(&format!("{}{}", "a {".repeat(70), "}".repeat(70))).is_err());
        assert!(parse(&"x".repeat(2 * 1024 * 1024 + 1)).is_err());
    }
}
