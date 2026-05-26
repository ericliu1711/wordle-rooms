.DEFAULT_GOAL := help

-include .env
export

.PHONY: up down backend frontend db db-reset tidy test help

up: ## Start Postgres in Docker
	docker compose up -d

down: ## Stop Docker services
	docker compose down

backend: ## Run the Go backend (hot-reload not included)
	cd backend && go run ./cmd/server

frontend: ## Run the Next.js dev server
	cd frontend && env -u PORT pnpm dev

db: ## Open a psql shell in the running Postgres container
	docker compose exec postgres psql -U wordle -d wordle

db-reset: ## Drop and recreate the wordle database (re-runs migrations + seed on next start)
	docker compose exec postgres psql -U wordle -d postgres -c "DROP DATABASE IF EXISTS wordle; CREATE DATABASE wordle;"

test: ## Run Go unit tests
	cd backend && go test ./...

tidy: ## Tidy Go module dependencies
	cd backend && go mod tidy

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
