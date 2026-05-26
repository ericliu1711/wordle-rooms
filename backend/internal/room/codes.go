package room

import "crypto/rand"

// GenerateCode returns a random 4-character A–Z room code.
func GenerateCode() string {
	const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand unavailable: " + err.Error())
	}
	out := make([]byte, 4)
	for i, v := range b {
		out[i] = alpha[int(v)%26]
	}
	return string(out)
}
