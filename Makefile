.PHONY: check test lint verify docker-build docker-up docker-down docker-smoke deploy smoke-prod

check: lint verify test

test:
	npm test

lint:
	npm run lint
	cd plaud-exporter && npm run lint

verify:
	npm run verify
	cd plaud-exporter && npm run verify

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
