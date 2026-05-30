.PHONY: check test test-extension lint lint-extension verify verify-extension docker-build docker-up docker-down docker-smoke deploy smoke-prod

# Mirrors `npm run check` (CI parity).
check:
	npm run check

test:
	npm test

test-extension:
	npm run test:extension

lint:
	npm run lint
	npm run lint:extension

verify:
	npm run verify
	npm run verify:extension

docker-build:
	docker build -t plaud-exporter:local .

docker-up:
	docker compose up -d --build

docker-down:
	docker compose down

docker-smoke:
	bash scripts/docker-smoke-image.sh plaud-exporter:smoke

deploy:
	ansible-playbook -i deploy/ansible/inventory.yml deploy/ansible/site.yml

smoke-prod:
	bash scripts/smoke-prod.sh
