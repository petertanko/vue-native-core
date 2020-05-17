// const fs = require('fs')
import * as compiler from 'vue-native-template-compiler'
import cssParse from 'css-parse'
import { js_beautify as beautify } from 'js-beautify'
import sourceMap from 'source-map'
import hash from 'hash-sum'
import path from 'path'
import lineNumber from 'line-number'
import parse5 from 'parse5'

import constants from './util/constants'
import { addvm } from './util/addvm'
import { parseCss } from './util/parseCss'

var newLine = /\r?\n/g

const DEFAULT_OUTPUT = {
  template: {
    import: `import { Component as ${constants.COMPONENT} } from 'react'`,
    render: `const ${constants.TEMPLATE_RENDER} = () => null`,
  },
  script: `const ${constants.SCRIPT_OPTIONS} = {}`,
}

export function compileVueToRn(resource, filename = 'sfc.vue') {
  const originalCodeString = resource.toString()
  const parsedSFC = compiler.parseComponent(originalCodeString, { pad: 'line' })

  let output = ''
  let mappings = ''

  // add react-vue import
  output += `import ${constants.VUE}, { observer as ${constants.OBSERVER} } from 'vue-native-core'`
  output += '\n'

  // // add react import
  // output += `import ${constants.REACT} from 'react'`
  // output += '\n';

  // add react-native import
  output += `import ${constants.REACT_NATIVE} from 'react-native'`
  output += '\n'

  // add prop-type import
  output += `import ${constants.PROP_TYPE} from 'prop-types'`
  output += '\n'

  // add component builder import
  output += `import { buildNativeComponent as ${constants.BUILD_COMPONENT} } from 'vue-native-helper'`
  output += '\n'

  // parse template
  const template = parsedSFC.template

  //Consider the start of template for debugging
  //
  let templateStartIndex = parsedSFC.template.start
  let templateStartLineNumber = originalCodeString
    .substring(0, templateStartIndex)
    .split(newLine).length

  // Get tags and location of tags from template
  //
  let templateASTNodes = []
  const templateFragments = parse5.parseFragment(parsedSFC.template.content, {
    sourceCodeLocationInfo: true,
  })
  if (templateFragments.childNodes) {
    traverse(templateFragments, templateASTNodes)
  }

  let generatedTemplateCode = DEFAULT_OUTPUT.template
  if (template) {
    const templateContent = template.content.replace(/\/\/\n/g, '').trim()
    if (templateContent) {
      generatedTemplateCode = parseTemplate(templateContent)
    }
  }

  // add render dep import
  output += generatedTemplateCode.import
  output += '\n'

  // parse script
  const script = parsedSFC.script
  let generatedScriptCode = DEFAULT_OUTPUT.script
  if (script) {
    const scriptContent = script.content.replace(/\/\/\n/g, '').trim()
    generatedScriptCode = parseScript(scriptContent)
    mappings = generateSourceMap(originalCodeString, filename)
  }

  if (mappings) {
    // Start of the script content
    //
    var beforeLines = output.split(newLine).length
    // Start of the script content of the original code
    //
    var scriptLine = originalCodeString
      .slice(0, parsedSFC.script.start)
      .split(newLine).length
    var exportDefaultIndex = originalCodeString.indexOf('export default')
    var exportDefaultLineNumber = originalCodeString
      .substring(0, exportDefaultIndex)
      .split(newLine).length
  }

  // add vue options
  output += generatedScriptCode
  output += '\n\n'

  var endLines = output.split(newLine).length - 1
  for (; scriptLine < endLines; scriptLine++) {
    //Skip export default line
    if (scriptLine !== exportDefaultLineNumber) {
      mappings.addMapping({
        source: mappings._hashedFilename,
        generated: {
          line: beforeLines,
          column: 0,
        },
        original: {
          line: scriptLine,
          column: 0,
        },
      })
    }
    beforeLines++
  }

  // add render funtion
  let beautifiedRender = beautify(
    addvm(generatedTemplateCode.render, { indent_size: 2 }),
  )
  output += beautifiedRender
  output += '\n\n'

  // Get last line of render code
  //
  let renderEndLine = beautifiedRender.split(newLine).length - 1

  // Search Elements and postion based on render function
  //
  var reactVueElementRegex = /__react__vue__createElement/
  let foundLines = lineNumber(beautifiedRender, reactVueElementRegex)
  if (mappings) {
    foundLines.forEach((line, index) => {
      let renderJsLine = endLines + line.number
      if (foundLines[index + 1]) {
        for (let i = line.number; i < foundLines[index + 1].number; i++) {
          // Add Mapping
          if (templateASTNodes[index]) {
            mappings.addMapping({
              source: mappings._hashedFilename,
              generated: {
                line: renderJsLine++,
                column: 0,
              },
              original: {
                line:
                  templateASTNodes[index].startTag.startLine +
                  templateStartLineNumber,
                column: 0,
              },
            })
          }
        }
      } else if (templateASTNodes[index] && templateASTNodes[index].startTag) {
        // Last Line
        for (let i = line.number; i < renderEndLine; i++) {
          // Add Mapping
          mappings.addMapping({
            source: mappings._hashedFilename,
            generated: {
              line: renderJsLine++,
              column: 0,
            },
            original: {
              line:
                templateASTNodes[index].startTag.startLine +
                templateStartLineNumber,
              column: 0,
            },
          })
        }
      }
    })
  }

  // parse css
  const styles = parsedSFC.styles
  let cssParsed = {}
  styles.forEach(function(v) {
    const cssAst = cssParse(v.content)
    cssParsed = Object.assign({}, cssParsed, parseCss(cssAst))
  })

  // add css obj
  output += `const ${constants.CSS} = ${JSON.stringify(cssParsed)}`
  output += '\n\n'

  // add builder
  output += `const ${constants.COMPONENT_BUILDED} = ${constants.BUILD_COMPONENT}(${constants.TEMPLATE_RENDER}, ${constants.SCRIPT_OPTIONS}, {Component: ${constants.COMPONENT}, PropTypes: ${constants.PROP_TYPE}, Vue: ${constants.VUE}, ReactNative: ${constants.REACT_NATIVE}, css: ${constants.CSS}})`
  output += '\n\n'

  // export default
  output += `export default ${constants.OBSERVER}(${constants.COMPONENT_BUILDED})`

  // beautiful
  // output = beautify(output, { indent_size: 2 });
  return { output, mappings: mappings ? mappings.toJSON() : null }
}

// function remove(name) {
//   fs.unlink(name.replace(FILTER, '.js'), function(err) {
//     if (err) {
//       throw err;
//     }
//   });
// }

function parseTemplate(code) {
  const obj = compiler.nativeCompiler(code)
  return {
    import: obj.importCode,
    render: `const ${constants.TEMPLATE_RENDER} = ${obj.renderCode}`,
  }
}

function generateSourceMap(content, filePath) {
  // hot-reload source map busting
  var hashedFilename = path.basename(filePath) + '?' + hash(filePath + content)
  var map = new sourceMap.SourceMapGenerator()
  map.setSourceContent(hashedFilename, content)
  map._hashedFilename = hashedFilename
  return map
}

function parseScript(code) {
  const s = `const ${constants.SCRIPT_OPTIONS} = `
  code = code
    .replace(/[\s;]*module.exports[\s]*=/, `\n${s}`)
    .replace(/[\s;]*export[\s]+default[\s]*\{/, `\n${s} {`)
  return code
}

function traverse(ast, nodes = []) {
  if (ast.tagName) {
    nodes.push(ast.sourceCodeLocation)
  }
  if (ast.childNodes) {
    ast.childNodes.forEach(child => {
      traverse(child, nodes)
    })
  }
}
