CREATE TABLE words (
    word TEXT PRIMARY KEY,
    is_answer BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_words_answers ON words(word) WHERE is_answer = true;
