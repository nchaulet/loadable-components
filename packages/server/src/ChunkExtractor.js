/* eslint-disable react/no-danger */
import path from 'path'
import fs from 'fs'
import _ from 'lodash'
import React from 'react'
import { invariant, LOADABLE_REQUIRED_CHUNKS_KEY } from './sharedInternals'
import ChunkExtractorManager from './ChunkExtractorManager'
import { smartRequire, joinURLPath } from './util'

const EXTENSION_SCRIPT_TYPES = {
  '.js': 'script',
  '.css': 'style',
}

function extensionToScriptType(extension) {
  return EXTENSION_SCRIPT_TYPES[extension] || null
}

function getAssets(chunks, getAsset) {
  return _.uniqBy(_.flatMap(chunks, chunk => getAsset(chunk)), 'url')
}

function extraPropsToString(extraProps) {
  return Object.keys(extraProps).reduce((acc, key) => `${acc} ${key}="${extraProps[key]}"`, '');
}

function assetToScriptTag(asset, extraProps) {
  return `<script async data-chunk="${asset.chunk}" src="${
    asset.url
  }"${extraPropsToString(extraProps)}></script>`
}

function assetToScriptElement(asset, extraProps) {
  return (
    <script key={asset.url} async data-chunk={asset.chunk} src={asset.url} {...extraProps} />
  )
}

function assetToStyleString(asset) {
  return new Promise((resolve, reject) => {
    fs.readFile(asset.path, 'utf8', (err, data) => {
      if (err) {
        reject(err)
        return
      }
      resolve(data)
    })
  })
}

function assetToStyleTag(asset, extraProps) {
  return `<link data-chunk="${asset.chunk}" rel="stylesheet" href="${
    asset.url
  }"${extraPropsToString(extraProps)}>`
}

function assetToStyleTagInline(asset, extraProps) {
  return new Promise((resolve, reject) => {
    fs.readFile(asset.path, 'utf8', (err, data) => {
      if (err) {
        reject(err)
        return
      }
      resolve(
        `<style type="text/css" data-chunk="${asset.chunk}"${extraPropsToString(extraProps)}>
${data}
</style>`,
      )
    })
  })
}

function assetToStyleElement(asset, extraProps) {
  return (
    <link
      key={asset.url}
      data-chunk={asset.chunk}
      rel="stylesheet"
      href={asset.url}
      {...extraProps}
    />
  )
}

function assetToStyleElementInline(asset, extraProps) {
  return new Promise((resolve, reject) => {
    fs.readFile(asset.path, 'utf8', (err, data) => {
      if (err) {
        reject(err)
        return
      }
      resolve(
        <style
          key={asset.url}
          data-chunk={asset.chunk}
          dangerouslySetInnerHTML={{ __html: data }}
          {...extraProps}
        />,
      )
    })
  })
}

const LINK_ASSET_HINTS = {
  mainAsset: 'data-chunk',
  childAsset: 'data-parent-chunk',
}

function assetToLinkTag(asset) {
  const hint = LINK_ASSET_HINTS[asset.type]
  return `<link ${hint}="${asset.chunk}" rel="${asset.linkType}" as="${
    asset.scriptType
  }" href="${asset.url}">`
}

function assetToLinkElement(asset) {
  const hint = LINK_ASSET_HINTS[asset.type]
  const props = {
    key: asset.url,
    [hint]: asset.chunk,
    rel: asset.linkType,
    as: asset.scriptType,
    href: asset.url,
  }
  return <link {...props} />
}

function joinTags(tags) {
  return tags.join('\n')
}

const HOT_UPDATE_REGEXP = /\.hot-update\.js$/

function isValidChunkAsset(chunkAsset) {
  return chunkAsset.scriptType && !HOT_UPDATE_REGEXP.test(chunkAsset.filename)
}

class ChunkExtractor {
  constructor({ statsFile, stats, entrypoints = ['main'], outputPath } = []) {
    this.stats = stats || smartRequire(statsFile)
    this.outputPath = outputPath || this.stats.outputPath
    this.statsFile = statsFile
    this.entrypoints = Array.isArray(entrypoints) ? entrypoints : [entrypoints]
    this.chunks = []
  }

  resolvePublicUrl(filename) {
    const { publicPath } = this.stats
    return joinURLPath(publicPath, filename)
  }

  getChunkGroup(chunk) {
    const chunkGroup = this.stats.namedChunkGroups[chunk]
    invariant(chunkGroup, `cannot find ${chunk} in stats`)
    return chunkGroup
  }

  createChunkAsset({ filename, chunk, type, linkType }) {
    return {
      filename,
      scriptType: extensionToScriptType(path.extname(filename).toLowerCase()),
      chunk,
      url: this.resolvePublicUrl(filename),
      path: path.join(this.outputPath, filename),
      type,
      linkType,
    }
  }

  getChunkAssets(chunks) {
    const one = chunk => {
      const chunkGroup = this.getChunkGroup(chunk)
      return chunkGroup.assets
        .map(filename =>
          this.createChunkAsset({
            filename,
            chunk,
            type: 'mainAsset',
            linkType: 'preload',
          }),
        )
        .filter(isValidChunkAsset)
    }

    if (Array.isArray(chunks)) {
      return getAssets(chunks, one)
    }

    return one(chunks)
  }

  getChunkChildAssets(chunks, type) {
    const one = chunk => {
      const chunkGroup = this.getChunkGroup(chunk)
      const assets = chunkGroup.childAssets[type] || []
      return assets
        .map(filename =>
          this.createChunkAsset({
            filename,
            chunk,
            type: 'childAsset',
            linkType: type,
          }),
        )
        .filter(isValidChunkAsset)
    }

    if (Array.isArray(chunks)) {
      return getAssets(chunks, one)
    }

    return one(chunks)
  }

  getChunkDependencies(chunks) {
    const one = chunk => {
      const chunkGroup = this.getChunkGroup(chunk)
      return chunkGroup.chunks
    }

    if (Array.isArray(chunks)) {
      return _.uniq(_.flatMap(chunks, one))
    }

    return one(chunks)
  }

  getRequiredChunksScriptContent() {
    return `window.${LOADABLE_REQUIRED_CHUNKS_KEY} = ${JSON.stringify(
      this.getChunkDependencies(this.chunks),
    )};`
  }

  getRequiredChunksScriptTag(extraProps) {
    return `<script${extraPropsToString(extraProps)}>${this.getRequiredChunksScriptContent()}</script>`
  }

  getRequiredChunksScriptElement(extraProps) {
    return (
      <script
        key="required"
        dangerouslySetInnerHTML={{
          __html: this.getRequiredChunksScriptContent(),
        }}
        {...extraProps}
      />
    )
  }

  // Public methods
  // -----------------

  // Collect

  addChunk(chunk) {
    if (this.chunks.indexOf(chunk) !== -1) return
    this.chunks.push(chunk)
  }

  collectChunks(app) {
    return <ChunkExtractorManager extractor={this}>{app}</ChunkExtractorManager>
  }

  // Utilities

  requireEntrypoint(entrypoint) {
    entrypoint = entrypoint || this.entrypoints[0]
    const assets = this.getChunkAssets(entrypoint)
    const mainAsset = assets.find(asset => asset.scriptType === 'script')
    invariant(mainAsset, 'asset not found')
    return smartRequire(mainAsset.path)
  }

  // Main assets

  getMainAssets(scriptType) {
    const chunks = [...this.chunks, ...this.entrypoints]
    const assets = this.getChunkAssets(chunks)
    if (scriptType) {
      return assets.filter(asset => asset.scriptType === scriptType)
    }
    return assets
  }

  getScriptTags(extraProps = {}) {
    const requiredScriptTag = this.getRequiredChunksScriptTag(extraProps)
    const mainAssets = this.getMainAssets('script')
    const assetsScriptTags = mainAssets.map(asset => assetToScriptTag(asset, extraProps))
    return joinTags([requiredScriptTag, ...assetsScriptTags])
  }

  getScriptElements(extraProps = {}) {
    const requiredScriptElement = this.getRequiredChunksScriptElement(extraProps)
    const mainAssets = this.getMainAssets('script')
    const assetsScriptElements = mainAssets.map(asset =>
      assetToScriptElement(asset, extraProps),
    )
    return [requiredScriptElement, ...assetsScriptElements]
  }

  getCssString() {
    const mainAssets = this.getMainAssets('style')
    const promises = mainAssets.map(asset =>
      assetToStyleString(asset).then(data => data),
    )
    return Promise.all(promises).then(results => joinTags(results))
  }

  getStyleTags(extraProps = {}) {
    const mainAssets = this.getMainAssets('style')
    return joinTags(mainAssets.map(asset => assetToStyleTag(asset, extraProps)))
  }

  getInlineStyleTags(extraProps = {}) {
    const mainAssets = this.getMainAssets('style')
    const promises = mainAssets.map(asset =>
      assetToStyleTagInline(asset, extraProps).then(data => data),
    )
    return Promise.all(promises).then(results => joinTags(results))
  }

  getStyleElements(extraProps = {}) {
    const mainAssets = this.getMainAssets('style')
    return mainAssets.map(asset => assetToStyleElement(asset, extraProps))
  }

  getInlineStyleElements(extraProps = {}) {
    const mainAssets = this.getMainAssets('style')
    const promises = mainAssets.map(asset =>
      assetToStyleElementInline(asset, extraProps).then(data => data),
    )
    return Promise.all(promises).then(results => results)
  }

  // Pre assets

  getPreAssets() {
    const mainAssets = this.getMainAssets()
    const chunks = [...this.chunks, ...this.entrypoints]
    const preloadAssets = this.getChunkChildAssets(chunks, 'preload')
    const prefetchAssets = this.getChunkChildAssets(chunks, 'prefetch')
    return [...mainAssets, ...preloadAssets, ...prefetchAssets]
  }

  getLinkTags() {
    const assets = this.getPreAssets()
    const linkTags = assets.map(asset => assetToLinkTag(asset))
    return joinTags(linkTags)
  }

  getLinkElements() {
    const assets = this.getPreAssets()
    return assets.map(asset => assetToLinkElement(asset))
  }
}

export default ChunkExtractor
