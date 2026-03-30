SHELL := /usr/bin/env bash

.PHONY: all build action install clean help

all: build

help:
	@printf '%s\n' \
		'Targets:' \
		'  make / make build  Build the bundled GitHub Action' \
		'  make action        Alias for build' \
		'  make install       Install action dependencies' \
		'  make clean         Remove generated action build artifacts'

build: install
	npm run build

action: build

install:
	npm ci

clean:
	rm -rf lib node_modules
