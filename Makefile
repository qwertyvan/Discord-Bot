# Convenience targets for the docker-compose stack.
# Run `make help` to list available commands.

.PHONY: help up down logs rebuild restart ps migrate plugins-list shell-api shell-bot

help: ## Show this help.
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-18s %s\n", $$1, $$2}'

up: ## Build images and start the full stack in the background.
	docker compose up -d --build

down: ## Stop and remove all containers (keeps volumes).
	docker compose down

logs: ## Tail logs from every service.
	docker compose logs -f --tail=200

rebuild: ## Rebuild images without using the cache.
	docker compose build --no-cache

restart: ## Restart api/bot/web (postgres stays up).
	docker compose restart api bot web

ps: ## Show container status.
	docker compose ps

migrate: ## Apply prisma schema to the running postgres (uses `db push`).
	docker compose exec api npx prisma db push

plugins-list: ## List plugin directories the bot will auto-load.
	@find plugins -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null | sort || true

shell-api: ## Drop into a shell in the api container.
	docker compose exec api sh

shell-bot: ## Drop into a shell in the bot container.
	docker compose exec bot sh
