package room

import (
	"crypto/rand"
	"encoding/base64"
)

// GenerateToken returns a 16-character base64url-encoded random token.
// 12 bytes of entropy → exactly 16 base64url characters.
func GenerateToken() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand unavailable: " + err.Error())
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
