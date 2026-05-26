package room

import "errors"

var (
	ErrRoomNotFound    = errors.New("room not found")
	ErrCodeCollision   = errors.New("could not allocate room code")
	ErrRoomNotJoinable = errors.New("room is not accepting new players")
	ErrNameTaken       = errors.New("name already in use")
	ErrInvalidName     = errors.New("invalid name")
	ErrNotHost         = errors.New("only the host can do that")
	ErrCannotStart     = errors.New("cannot start round in this state")
	ErrNotInRoom       = errors.New("you are not in this room")
	ErrNotYourTurn     = errors.New("you cannot guess right now")
	ErrCannotNextRound  = errors.New("cannot start next round in this state")
	ErrNotEnoughPlayers = errors.New("need at least 2 players to start")
)
