# Generators

> **Upstream guide:** inherited from zneix/haste-server v0.2.5 (John Crepezzi, zneix, and contributors), under the [MIT licence](../LICENSE). Tinkercademy added this note; the text below is retained as upstream reference. In this fork, configuration is in `config.js`, not `config.json`; consult [`example.config.js`](../example.config.js) for current defaults.

Here's a list of all supported random string generators.  
One of these is meant to be set in `config.json` as `keyGenerator` object.  
Default type is [random](#random) with all alphanumeric characters as keyspace.


**Table of Contents**

- [Phonetic](#phonetic)
- [Random](#random)
- [Dictionary](#dictionary)

## Random

Generates a random key from set of characters in `keysapce`.  
Keyspace can be left empty to use all alphanumeric characters instead.

``` json
{
	"type": "random",
	"keyspace": "abcdef"
}
```

## Phonetic

Generates phonetic key with a combination of vovels similar to `pwgen` command on linux.

``` json
{
	"type": "phonetic"
}
```

## Dictionary

Generates a key consisting of words from file named `words.txt`, one word per line.  
To avoid any issues with URL length, it is recommended to use `keyLength` 5 or shorter.

```json
{
	"type": "dictionary",
	"path": "./words.txt"
}
```
