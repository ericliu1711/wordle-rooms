package game

import (
	"reflect"
	"testing"
)

func TestScore(t *testing.T) {
	tests := []struct {
		name   string
		guess  string
		target string
		want   []string
	}{
		{
			name:   "ALLEY+LLAMA: direct pos1 match is green, one remaining L and A are yellow",
			guess:  "LLAMA",
			target: "ALLEY",
			want:   []string{"yellow", "green", "yellow", "gray", "gray"},
		},
		{
			name:   "ALLEY+LULLS: direct pos2 match is green, one remaining L is yellow, extras gray",
			guess:  "LULLS",
			target: "ALLEY",
			want:   []string{"yellow", "gray", "green", "gray", "gray"},
		},
		{
			name:   "REACT+REACT: all correct",
			guess:  "REACT",
			target: "REACT",
			want:   []string{"green", "green", "green", "green", "green"},
		},
		{
			name:   "REACT+TACOS: T A C all present, O S absent",
			guess:  "TACOS",
			target: "REACT",
			want:   []string{"yellow", "yellow", "yellow", "gray", "gray"},
		},
		{
			// DEPOT: D(0)E(1)P(2)O(3)T(4). Pass1: no greens. Pass2: S→none, P→P(2), E→E(1), E→none(E consumed), D→D(0)
			name:   "duplicate E in guess: first E gets yellow, second E is gray",
			guess:  "SPEED",
			target: "DEPOT",
			want:   []string{"gray", "yellow", "yellow", "gray", "yellow"},
		},
		{
			name:   "no overlap",
			guess:  "BRICK",
			target: "SHOWY",
			want:   []string{"gray", "gray", "gray", "gray", "gray"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Score(tt.guess, tt.target)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("Score(%q, %q)\n  got  %v\n  want %v", tt.guess, tt.target, got, tt.want)
			}
		})
	}
}
