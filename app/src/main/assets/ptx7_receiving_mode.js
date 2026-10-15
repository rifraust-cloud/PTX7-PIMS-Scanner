/* PTX7 beta21: bundled offline QR encoder (qrcode-generator, MIT, Kazuhiko Arase).
   Namespaced to window.__ptx7QR so it never collides with page globals. */
(function(){
  if (window.__ptx7QR) return;
  var module = { exports: {} }, exports = module.exports;
//---------------------------------------------------------------------
//
// QR Code Generator for JavaScript
//
// Copyright (c) 2009 Kazuhiko Arase
//
// URL: http://www.d-project.com/
//
// Licensed under the MIT license:
//  http://www.opensource.org/licenses/mit-license.php
//
// The word 'QR Code' is registered trademark of
// DENSO WAVE INCORPORATED
//  http://www.denso-wave.com/qrcode/faqpatent-e.html
//
//---------------------------------------------------------------------

var qrcode = function() {

  //---------------------------------------------------------------------
  // qrcode
  //---------------------------------------------------------------------

  /**
   * qrcode
   * @param typeNumber 1 to 40
   * @param errorCorrectionLevel 'L','M','Q','H'
   */
  var qrcode = function(typeNumber, errorCorrectionLevel) {

    var PAD0 = 0xEC;
    var PAD1 = 0x11;

    var _typeNumber = typeNumber;
    var _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
    var _modules = null;
    var _moduleCount = 0;
    var _dataCache = null;
    var _dataList = [];

    var _this = {};

    var makeImpl = function(test, maskPattern) {

      _moduleCount = _typeNumber * 4 + 17;
      _modules = function(moduleCount) {
        var modules = new Array(moduleCount);
        for (var row = 0; row < moduleCount; row += 1) {
          modules[row] = new Array(moduleCount);
          for (var col = 0; col < moduleCount; col += 1) {
            modules[row][col] = null;
          }
        }
        return modules;
      }(_moduleCount);

      setupPositionProbePattern(0, 0);
      setupPositionProbePattern(_moduleCount - 7, 0);
      setupPositionProbePattern(0, _moduleCount - 7);
      setupPositionAdjustPattern();
      setupTimingPattern();
      setupTypeInfo(test, maskPattern);

      if (_typeNumber >= 7) {
        setupTypeNumber(test);
      }

      if (_dataCache == null) {
        _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
      }

      mapData(_dataCache, maskPattern);
    };

    var setupPositionProbePattern = function(row, col) {

      for (var r = -1; r <= 7; r += 1) {

        if (row + r <= -1 || _moduleCount <= row + r) continue;

        for (var c = -1; c <= 7; c += 1) {

          if (col + c <= -1 || _moduleCount <= col + c) continue;

          if ( (0 <= r && r <= 6 && (c == 0 || c == 6) )
              || (0 <= c && c <= 6 && (r == 0 || r == 6) )
              || (2 <= r && r <= 4 && 2 <= c && c <= 4) ) {
            _modules[row + r][col + c] = true;
          } else {
            _modules[row + r][col + c] = false;
          }
        }
      }
    };

    var getBestMaskPattern = function() {

      var minLostPoint = 0;
      var pattern = 0;

      for (var i = 0; i < 8; i += 1) {

        makeImpl(true, i);

        var lostPoint = QRUtil.getLostPoint(_this);

        if (i == 0 || minLostPoint > lostPoint) {
          minLostPoint = lostPoint;
          pattern = i;
        }
      }

      return pattern;
    };

    var setupTimingPattern = function() {

      for (var r = 8; r < _moduleCount - 8; r += 1) {
        if (_modules[r][6] != null) {
          continue;
        }
        _modules[r][6] = (r % 2 == 0);
      }

      for (var c = 8; c < _moduleCount - 8; c += 1) {
        if (_modules[6][c] != null) {
          continue;
        }
        _modules[6][c] = (c % 2 == 0);
      }
    };

    var setupPositionAdjustPattern = function() {

      var pos = QRUtil.getPatternPosition(_typeNumber);

      for (var i = 0; i < pos.length; i += 1) {

        for (var j = 0; j < pos.length; j += 1) {

          var row = pos[i];
          var col = pos[j];

          if (_modules[row][col] != null) {
            continue;
          }

          for (var r = -2; r <= 2; r += 1) {

            for (var c = -2; c <= 2; c += 1) {

              if (r == -2 || r == 2 || c == -2 || c == 2
                  || (r == 0 && c == 0) ) {
                _modules[row + r][col + c] = true;
              } else {
                _modules[row + r][col + c] = false;
              }
            }
          }
        }
      }
    };

    var setupTypeNumber = function(test) {

      var bits = QRUtil.getBCHTypeNumber(_typeNumber);

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
      }

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
      }
    };

    var setupTypeInfo = function(test, maskPattern) {

      var data = (_errorCorrectionLevel << 3) | maskPattern;
      var bits = QRUtil.getBCHTypeInfo(data);

      // vertical
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 6) {
          _modules[i][8] = mod;
        } else if (i < 8) {
          _modules[i + 1][8] = mod;
        } else {
          _modules[_moduleCount - 15 + i][8] = mod;
        }
      }

      // horizontal
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 8) {
          _modules[8][_moduleCount - i - 1] = mod;
        } else if (i < 9) {
          _modules[8][15 - i - 1 + 1] = mod;
        } else {
          _modules[8][15 - i - 1] = mod;
        }
      }

      // fixed module
      _modules[_moduleCount - 8][8] = (!test);
    };

    var mapData = function(data, maskPattern) {

      var inc = -1;
      var row = _moduleCount - 1;
      var bitIndex = 7;
      var byteIndex = 0;
      var maskFunc = QRUtil.getMaskFunction(maskPattern);

      for (var col = _moduleCount - 1; col > 0; col -= 2) {

        if (col == 6) col -= 1;

        while (true) {

          for (var c = 0; c < 2; c += 1) {

            if (_modules[row][col - c] == null) {

              var dark = false;

              if (byteIndex < data.length) {
                dark = ( ( (data[byteIndex] >>> bitIndex) & 1) == 1);
              }

              var mask = maskFunc(row, col - c);

              if (mask) {
                dark = !dark;
              }

              _modules[row][col - c] = dark;
              bitIndex -= 1;

              if (bitIndex == -1) {
                byteIndex += 1;
                bitIndex = 7;
              }
            }
          }

          row += inc;

          if (row < 0 || _moduleCount <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    };

    var createBytes = function(buffer, rsBlocks) {

      var offset = 0;

      var maxDcCount = 0;
      var maxEcCount = 0;

      var dcdata = new Array(rsBlocks.length);
      var ecdata = new Array(rsBlocks.length);

      for (var r = 0; r < rsBlocks.length; r += 1) {

        var dcCount = rsBlocks[r].dataCount;
        var ecCount = rsBlocks[r].totalCount - dcCount;

        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);

        dcdata[r] = new Array(dcCount);

        for (var i = 0; i < dcdata[r].length; i += 1) {
          dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
        }
        offset += dcCount;

        var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);

        var modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (var i = 0; i < ecdata[r].length; i += 1) {
          var modIndex = i + modPoly.getLength() - ecdata[r].length;
          ecdata[r][i] = (modIndex >= 0)? modPoly.getAt(modIndex) : 0;
        }
      }

      var totalCodeCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalCodeCount += rsBlocks[i].totalCount;
      }

      var data = new Array(totalCodeCount);
      var index = 0;

      for (var i = 0; i < maxDcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < dcdata[r].length) {
            data[index] = dcdata[r][i];
            index += 1;
          }
        }
      }

      for (var i = 0; i < maxEcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < ecdata[r].length) {
            data[index] = ecdata[r][i];
            index += 1;
          }
        }
      }

      return data;
    };

    var createData = function(typeNumber, errorCorrectionLevel, dataList) {

      var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);

      var buffer = qrBitBuffer();

      for (var i = 0; i < dataList.length; i += 1) {
        var data = dataList[i];
        buffer.put(data.getMode(), 4);
        buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
        data.write(buffer);
      }

      // calc num max data.
      var totalDataCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalDataCount += rsBlocks[i].dataCount;
      }

      if (buffer.getLengthInBits() > totalDataCount * 8) {
        throw 'code length overflow. ('
          + buffer.getLengthInBits()
          + '>'
          + totalDataCount * 8
          + ')';
      }

      // end code
      if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
        buffer.put(0, 4);
      }

      // padding
      while (buffer.getLengthInBits() % 8 != 0) {
        buffer.putBit(false);
      }

      // padding
      while (true) {

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD0, 8);

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD1, 8);
      }

      return createBytes(buffer, rsBlocks);
    };

    _this.addData = function(data, mode) {

      mode = mode || 'Byte';

      var newData = null;

      switch(mode) {
      case 'Numeric' :
        newData = qrNumber(data);
        break;
      case 'Alphanumeric' :
        newData = qrAlphaNum(data);
        break;
      case 'Byte' :
        newData = qr8BitByte(data);
        break;
      case 'Kanji' :
        newData = qrKanji(data);
        break;
      default :
        throw 'mode:' + mode;
      }

      _dataList.push(newData);
      _dataCache = null;
    };

    _this.isDark = function(row, col) {
      if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
        throw row + ',' + col;
      }
      return _modules[row][col];
    };

    _this.getModuleCount = function() {
      return _moduleCount;
    };

    _this.make = function() {
      if (_typeNumber < 1) {
        var typeNumber = 1;

        for (; typeNumber < 40; typeNumber++) {
          var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
          var buffer = qrBitBuffer();

          for (var i = 0; i < _dataList.length; i++) {
            var data = _dataList[i];
            buffer.put(data.getMode(), 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
            data.write(buffer);
          }

          var totalDataCount = 0;
          for (var i = 0; i < rsBlocks.length; i++) {
            totalDataCount += rsBlocks[i].dataCount;
          }

          if (buffer.getLengthInBits() <= totalDataCount * 8) {
            break;
          }
        }

        _typeNumber = typeNumber;
      }

      makeImpl(false, getBestMaskPattern() );
    };

    _this.createTableTag = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var qrHtml = '';

      qrHtml += '<table style="';
      qrHtml += ' border-width: 0px; border-style: none;';
      qrHtml += ' border-collapse: collapse;';
      qrHtml += ' padding: 0px; margin: ' + margin + 'px;';
      qrHtml += '">';
      qrHtml += '<tbody>';

      for (var r = 0; r < _this.getModuleCount(); r += 1) {

        qrHtml += '<tr>';

        for (var c = 0; c < _this.getModuleCount(); c += 1) {
          qrHtml += '<td style="';
          qrHtml += ' border-width: 0px; border-style: none;';
          qrHtml += ' border-collapse: collapse;';
          qrHtml += ' padding: 0px; margin: 0px;';
          qrHtml += ' width: ' + cellSize + 'px;';
          qrHtml += ' height: ' + cellSize + 'px;';
          qrHtml += ' background-color: ';
          qrHtml += _this.isDark(r, c)? '#000000' : '#ffffff';
          qrHtml += ';';
          qrHtml += '"/>';
        }

        qrHtml += '</tr>';
      }

      qrHtml += '</tbody>';
      qrHtml += '</table>';

      return qrHtml;
    };

    _this.createSvgTag = function(cellSize, margin, alt, title) {

      var opts = {};
      if (typeof arguments[0] == 'object') {
        // Called by options.
        opts = arguments[0];
        // overwrite cellSize and margin.
        cellSize = opts.cellSize;
        margin = opts.margin;
        alt = opts.alt;
        title = opts.title;
      }

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      // Compose alt property surrogate
      alt = (typeof alt === 'string') ? {text: alt} : alt || {};
      alt.text = alt.text || null;
      alt.id = (alt.text) ? alt.id || 'qrcode-description' : null;

      // Compose title property surrogate
      title = (typeof title === 'string') ? {text: title} : title || {};
      title.text = title.text || null;
      title.id = (title.text) ? title.id || 'qrcode-title' : null;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var c, mc, r, mr, qrSvg='', rect;

      rect = 'l' + cellSize + ',0 0,' + cellSize +
        ' -' + cellSize + ',0 0,-' + cellSize + 'z ';

      qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
      qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : '';
      qrSvg += ' viewBox="0 0 ' + size + ' ' + size + '" ';
      qrSvg += ' preserveAspectRatio="xMinYMin meet"';
      qrSvg += (title.text || alt.text) ? ' role="img" aria-labelledby="' +
          escapeXml([title.id, alt.id].join(' ').trim() ) + '"' : '';
      qrSvg += '>';
      qrSvg += (title.text) ? '<title id="' + escapeXml(title.id) + '">' +
          escapeXml(title.text) + '</title>' : '';
      qrSvg += (alt.text) ? '<description id="' + escapeXml(alt.id) + '">' +
          escapeXml(alt.text) + '</description>' : '';
      qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
      qrSvg += '<path d="';

      for (r = 0; r < _this.getModuleCount(); r += 1) {
        mr = r * cellSize + margin;
        for (c = 0; c < _this.getModuleCount(); c += 1) {
          if (_this.isDark(r, c) ) {
            mc = c*cellSize+margin;
            qrSvg += 'M' + mc + ',' + mr + rect;
          }
        }
      }

      qrSvg += '" stroke="transparent" fill="black"/>';
      qrSvg += '</svg>';

      return qrSvg;
    };

    _this.createDataURL = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      return createDataURL(size, size, function(x, y) {
        if (min <= x && x < max && min <= y && y < max) {
          var c = Math.floor( (x - min) / cellSize);
          var r = Math.floor( (y - min) / cellSize);
          return _this.isDark(r, c)? 0 : 1;
        } else {
          return 1;
        }
      } );
    };

    _this.createImgTag = function(cellSize, margin, alt) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;

      var img = '';
      img += '<img';
      img += '\u0020src="';
      img += _this.createDataURL(cellSize, margin);
      img += '"';
      img += '\u0020width="';
      img += size;
      img += '"';
      img += '\u0020height="';
      img += size;
      img += '"';
      if (alt) {
        img += '\u0020alt="';
        img += escapeXml(alt);
        img += '"';
      }
      img += '/>';

      return img;
    };

    var escapeXml = function(s) {
      var escaped = '';
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charAt(i);
        switch(c) {
        case '<': escaped += '&lt;'; break;
        case '>': escaped += '&gt;'; break;
        case '&': escaped += '&amp;'; break;
        case '"': escaped += '&quot;'; break;
        default : escaped += c; break;
        }
      }
      return escaped;
    };

    var _createHalfASCII = function(margin) {
      var cellSize = 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r1, r2, p;

      var blocks = {
        '██': '█',
        '█ ': '▀',
        ' █': '▄',
        '  ': ' '
      };

      var blocksLastLineNoMargin = {
        '██': '▀',
        '█ ': '▀',
        ' █': ' ',
        '  ': ' '
      };

      var ascii = '';
      for (y = 0; y < size; y += 2) {
        r1 = Math.floor((y - min) / cellSize);
        r2 = Math.floor((y + 1 - min) / cellSize);
        for (x = 0; x < size; x += 1) {
          p = '█';

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
            p = ' ';
          }

          if (min <= x && x < max && min <= y+1 && y+1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
            p += ' ';
          }
          else {
            p += '█';
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          ascii += (margin < 1 && y+1 >= max) ? blocksLastLineNoMargin[p] : blocks[p];
        }

        ascii += '\n';
      }

      if (size % 2 && margin > 0) {
        return ascii.substring(0, ascii.length - size - 1) + Array(size+1).join('▀');
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.createASCII = function(cellSize, margin) {
      cellSize = cellSize || 1;

      if (cellSize < 2) {
        return _createHalfASCII(margin);
      }

      cellSize -= 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r, p;

      var white = Array(cellSize+1).join('██');
      var black = Array(cellSize+1).join('  ');

      var ascii = '';
      var line = '';
      for (y = 0; y < size; y += 1) {
        r = Math.floor( (y - min) / cellSize);
        line = '';
        for (x = 0; x < size; x += 1) {
          p = 1;

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
            p = 0;
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          line += p ? white : black;
        }

        for (r = 0; r < cellSize; r += 1) {
          ascii += line + '\n';
        }
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.renderTo2dContext = function(context, cellSize) {
      cellSize = cellSize || 2;
      var length = _this.getModuleCount();
      for (var row = 0; row < length; row++) {
        for (var col = 0; col < length; col++) {
          context.fillStyle = _this.isDark(row, col) ? 'black' : 'white';
          context.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
    }

    return _this;
  };

  //---------------------------------------------------------------------
  // qrcode.stringToBytes
  //---------------------------------------------------------------------

  qrcode.stringToBytesFuncs = {
    'default' : function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        bytes.push(c & 0xff);
      }
      return bytes;
    }
  };

  qrcode.stringToBytes = qrcode.stringToBytesFuncs['default'];

  //---------------------------------------------------------------------
  // qrcode.createStringToBytes
  //---------------------------------------------------------------------

  /**
   * @param unicodeData base64 string of byte array.
   * [16bit Unicode],[16bit Bytes], ...
   * @param numChars
   */
  qrcode.createStringToBytes = function(unicodeData, numChars) {

    // create conversion map.

    var unicodeMap = function() {

      var bin = base64DecodeInputStream(unicodeData);
      var read = function() {
        var b = bin.read();
        if (b == -1) throw 'eof';
        return b;
      };

      var count = 0;
      var unicodeMap = {};
      while (true) {
        var b0 = bin.read();
        if (b0 == -1) break;
        var b1 = read();
        var b2 = read();
        var b3 = read();
        var k = String.fromCharCode( (b0 << 8) | b1);
        var v = (b2 << 8) | b3;
        unicodeMap[k] = v;
        count += 1;
      }
      if (count != numChars) {
        throw count + ' != ' + numChars;
      }

      return unicodeMap;
    }();

    var unknownChar = '?'.charCodeAt(0);

    return function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        if (c < 128) {
          bytes.push(c);
        } else {
          var b = unicodeMap[s.charAt(i)];
          if (typeof b == 'number') {
            if ( (b & 0xff) == b) {
              // 1byte
              bytes.push(b);
            } else {
              // 2bytes
              bytes.push(b >>> 8);
              bytes.push(b & 0xff);
            }
          } else {
            bytes.push(unknownChar);
          }
        }
      }
      return bytes;
    };
  };

  //---------------------------------------------------------------------
  // QRMode
  //---------------------------------------------------------------------

  var QRMode = {
    MODE_NUMBER :    1 << 0,
    MODE_ALPHA_NUM : 1 << 1,
    MODE_8BIT_BYTE : 1 << 2,
    MODE_KANJI :     1 << 3
  };

  //---------------------------------------------------------------------
  // QRErrorCorrectionLevel
  //---------------------------------------------------------------------

  var QRErrorCorrectionLevel = {
    L : 1,
    M : 0,
    Q : 3,
    H : 2
  };

  //---------------------------------------------------------------------
  // QRMaskPattern
  //---------------------------------------------------------------------

  var QRMaskPattern = {
    PATTERN000 : 0,
    PATTERN001 : 1,
    PATTERN010 : 2,
    PATTERN011 : 3,
    PATTERN100 : 4,
    PATTERN101 : 5,
    PATTERN110 : 6,
    PATTERN111 : 7
  };

  //---------------------------------------------------------------------
  // QRUtil
  //---------------------------------------------------------------------

  var QRUtil = function() {

    var PATTERN_POSITION_TABLE = [
      [],
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38],
      [6, 24, 42],
      [6, 26, 46],
      [6, 28, 50],
      [6, 30, 54],
      [6, 32, 58],
      [6, 34, 62],
      [6, 26, 46, 66],
      [6, 26, 48, 70],
      [6, 26, 50, 74],
      [6, 30, 54, 78],
      [6, 30, 56, 82],
      [6, 30, 58, 86],
      [6, 34, 62, 90],
      [6, 28, 50, 72, 94],
      [6, 26, 50, 74, 98],
      [6, 30, 54, 78, 102],
      [6, 28, 54, 80, 106],
      [6, 32, 58, 84, 110],
      [6, 30, 58, 86, 114],
      [6, 34, 62, 90, 118],
      [6, 26, 50, 74, 98, 122],
      [6, 30, 54, 78, 102, 126],
      [6, 26, 52, 78, 104, 130],
      [6, 30, 56, 82, 108, 134],
      [6, 34, 60, 86, 112, 138],
      [6, 30, 58, 86, 114, 142],
      [6, 34, 62, 90, 118, 146],
      [6, 30, 54, 78, 102, 126, 150],
      [6, 24, 50, 76, 102, 128, 154],
      [6, 28, 54, 80, 106, 132, 158],
      [6, 32, 58, 84, 110, 136, 162],
      [6, 26, 54, 82, 110, 138, 166],
      [6, 30, 58, 86, 114, 142, 170]
    ];
    var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
    var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
    var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

    var _this = {};

    var getBCHDigit = function(data) {
      var digit = 0;
      while (data != 0) {
        digit += 1;
        data >>>= 1;
      }
      return digit;
    };

    _this.getBCHTypeInfo = function(data) {
      var d = data << 10;
      while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
        d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15) ) );
      }
      return ( (data << 10) | d) ^ G15_MASK;
    };

    _this.getBCHTypeNumber = function(data) {
      var d = data << 12;
      while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
        d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18) ) );
      }
      return (data << 12) | d;
    };

    _this.getPatternPosition = function(typeNumber) {
      return PATTERN_POSITION_TABLE[typeNumber - 1];
    };

    _this.getMaskFunction = function(maskPattern) {

      switch (maskPattern) {

      case QRMaskPattern.PATTERN000 :
        return function(i, j) { return (i + j) % 2 == 0; };
      case QRMaskPattern.PATTERN001 :
        return function(i, j) { return i % 2 == 0; };
      case QRMaskPattern.PATTERN010 :
        return function(i, j) { return j % 3 == 0; };
      case QRMaskPattern.PATTERN011 :
        return function(i, j) { return (i + j) % 3 == 0; };
      case QRMaskPattern.PATTERN100 :
        return function(i, j) { return (Math.floor(i / 2) + Math.floor(j / 3) ) % 2 == 0; };
      case QRMaskPattern.PATTERN101 :
        return function(i, j) { return (i * j) % 2 + (i * j) % 3 == 0; };
      case QRMaskPattern.PATTERN110 :
        return function(i, j) { return ( (i * j) % 2 + (i * j) % 3) % 2 == 0; };
      case QRMaskPattern.PATTERN111 :
        return function(i, j) { return ( (i * j) % 3 + (i + j) % 2) % 2 == 0; };

      default :
        throw 'bad maskPattern:' + maskPattern;
      }
    };

    _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
      var a = qrPolynomial([1], 0);
      for (var i = 0; i < errorCorrectLength; i += 1) {
        a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0) );
      }
      return a;
    };

    _this.getLengthInBits = function(mode, type) {

      if (1 <= type && type < 10) {

        // 1 - 9

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 10;
        case QRMode.MODE_ALPHA_NUM : return 9;
        case QRMode.MODE_8BIT_BYTE : return 8;
        case QRMode.MODE_KANJI     : return 8;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 27) {

        // 10 - 26

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 12;
        case QRMode.MODE_ALPHA_NUM : return 11;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 10;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 41) {

        // 27 - 40

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 14;
        case QRMode.MODE_ALPHA_NUM : return 13;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 12;
        default :
          throw 'mode:' + mode;
        }

      } else {
        throw 'type:' + type;
      }
    };

    _this.getLostPoint = function(qrcode) {

      var moduleCount = qrcode.getModuleCount();

      var lostPoint = 0;

      // LEVEL1

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount; col += 1) {

          var sameCount = 0;
          var dark = qrcode.isDark(row, col);

          for (var r = -1; r <= 1; r += 1) {

            if (row + r < 0 || moduleCount <= row + r) {
              continue;
            }

            for (var c = -1; c <= 1; c += 1) {

              if (col + c < 0 || moduleCount <= col + c) {
                continue;
              }

              if (r == 0 && c == 0) {
                continue;
              }

              if (dark == qrcode.isDark(row + r, col + c) ) {
                sameCount += 1;
              }
            }
          }

          if (sameCount > 5) {
            lostPoint += (3 + sameCount - 5);
          }
        }
      };

      // LEVEL2

      for (var row = 0; row < moduleCount - 1; row += 1) {
        for (var col = 0; col < moduleCount - 1; col += 1) {
          var count = 0;
          if (qrcode.isDark(row, col) ) count += 1;
          if (qrcode.isDark(row + 1, col) ) count += 1;
          if (qrcode.isDark(row, col + 1) ) count += 1;
          if (qrcode.isDark(row + 1, col + 1) ) count += 1;
          if (count == 0 || count == 4) {
            lostPoint += 3;
          }
        }
      }

      // LEVEL3

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount - 6; col += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row, col + 1)
              &&  qrcode.isDark(row, col + 2)
              &&  qrcode.isDark(row, col + 3)
              &&  qrcode.isDark(row, col + 4)
              && !qrcode.isDark(row, col + 5)
              &&  qrcode.isDark(row, col + 6) ) {
            lostPoint += 40;
          }
        }
      }

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount - 6; row += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row + 1, col)
              &&  qrcode.isDark(row + 2, col)
              &&  qrcode.isDark(row + 3, col)
              &&  qrcode.isDark(row + 4, col)
              && !qrcode.isDark(row + 5, col)
              &&  qrcode.isDark(row + 6, col) ) {
            lostPoint += 40;
          }
        }
      }

      // LEVEL4

      var darkCount = 0;

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount; row += 1) {
          if (qrcode.isDark(row, col) ) {
            darkCount += 1;
          }
        }
      }

      var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;

      return lostPoint;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // QRMath
  //---------------------------------------------------------------------

  var QRMath = function() {

    var EXP_TABLE = new Array(256);
    var LOG_TABLE = new Array(256);

    // initialize tables
    for (var i = 0; i < 8; i += 1) {
      EXP_TABLE[i] = 1 << i;
    }
    for (var i = 8; i < 256; i += 1) {
      EXP_TABLE[i] = EXP_TABLE[i - 4]
        ^ EXP_TABLE[i - 5]
        ^ EXP_TABLE[i - 6]
        ^ EXP_TABLE[i - 8];
    }
    for (var i = 0; i < 255; i += 1) {
      LOG_TABLE[EXP_TABLE[i] ] = i;
    }

    var _this = {};

    _this.glog = function(n) {

      if (n < 1) {
        throw 'glog(' + n + ')';
      }

      return LOG_TABLE[n];
    };

    _this.gexp = function(n) {

      while (n < 0) {
        n += 255;
      }

      while (n >= 256) {
        n -= 255;
      }

      return EXP_TABLE[n];
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrPolynomial
  //---------------------------------------------------------------------

  function qrPolynomial(num, shift) {

    if (typeof num.length == 'undefined') {
      throw num.length + '/' + shift;
    }

    var _num = function() {
      var offset = 0;
      while (offset < num.length && num[offset] == 0) {
        offset += 1;
      }
      var _num = new Array(num.length - offset + shift);
      for (var i = 0; i < num.length - offset; i += 1) {
        _num[i] = num[i + offset];
      }
      return _num;
    }();

    var _this = {};

    _this.getAt = function(index) {
      return _num[index];
    };

    _this.getLength = function() {
      return _num.length;
    };

    _this.multiply = function(e) {

      var num = new Array(_this.getLength() + e.getLength() - 1);

      for (var i = 0; i < _this.getLength(); i += 1) {
        for (var j = 0; j < e.getLength(); j += 1) {
          num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i) ) + QRMath.glog(e.getAt(j) ) );
        }
      }

      return qrPolynomial(num, 0);
    };

    _this.mod = function(e) {

      if (_this.getLength() - e.getLength() < 0) {
        return _this;
      }

      var ratio = QRMath.glog(_this.getAt(0) ) - QRMath.glog(e.getAt(0) );

      var num = new Array(_this.getLength() );
      for (var i = 0; i < _this.getLength(); i += 1) {
        num[i] = _this.getAt(i);
      }

      for (var i = 0; i < e.getLength(); i += 1) {
        num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i) ) + ratio);
      }

      // recursive call
      return qrPolynomial(num, 0).mod(e);
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // QRRSBlock
  //---------------------------------------------------------------------

  var QRRSBlock = function() {

    var RS_BLOCK_TABLE = [

      // L
      // M
      // Q
      // H

      // 1
      [1, 26, 19],
      [1, 26, 16],
      [1, 26, 13],
      [1, 26, 9],

      // 2
      [1, 44, 34],
      [1, 44, 28],
      [1, 44, 22],
      [1, 44, 16],

      // 3
      [1, 70, 55],
      [1, 70, 44],
      [2, 35, 17],
      [2, 35, 13],

      // 4
      [1, 100, 80],
      [2, 50, 32],
      [2, 50, 24],
      [4, 25, 9],

      // 5
      [1, 134, 108],
      [2, 67, 43],
      [2, 33, 15, 2, 34, 16],
      [2, 33, 11, 2, 34, 12],

      // 6
      [2, 86, 68],
      [4, 43, 27],
      [4, 43, 19],
      [4, 43, 15],

      // 7
      [2, 98, 78],
      [4, 49, 31],
      [2, 32, 14, 4, 33, 15],
      [4, 39, 13, 1, 40, 14],

      // 8
      [2, 121, 97],
      [2, 60, 38, 2, 61, 39],
      [4, 40, 18, 2, 41, 19],
      [4, 40, 14, 2, 41, 15],

      // 9
      [2, 146, 116],
      [3, 58, 36, 2, 59, 37],
      [4, 36, 16, 4, 37, 17],
      [4, 36, 12, 4, 37, 13],

      // 10
      [2, 86, 68, 2, 87, 69],
      [4, 69, 43, 1, 70, 44],
      [6, 43, 19, 2, 44, 20],
      [6, 43, 15, 2, 44, 16],

      // 11
      [4, 101, 81],
      [1, 80, 50, 4, 81, 51],
      [4, 50, 22, 4, 51, 23],
      [3, 36, 12, 8, 37, 13],

      // 12
      [2, 116, 92, 2, 117, 93],
      [6, 58, 36, 2, 59, 37],
      [4, 46, 20, 6, 47, 21],
      [7, 42, 14, 4, 43, 15],

      // 13
      [4, 133, 107],
      [8, 59, 37, 1, 60, 38],
      [8, 44, 20, 4, 45, 21],
      [12, 33, 11, 4, 34, 12],

      // 14
      [3, 145, 115, 1, 146, 116],
      [4, 64, 40, 5, 65, 41],
      [11, 36, 16, 5, 37, 17],
      [11, 36, 12, 5, 37, 13],

      // 15
      [5, 109, 87, 1, 110, 88],
      [5, 65, 41, 5, 66, 42],
      [5, 54, 24, 7, 55, 25],
      [11, 36, 12, 7, 37, 13],

      // 16
      [5, 122, 98, 1, 123, 99],
      [7, 73, 45, 3, 74, 46],
      [15, 43, 19, 2, 44, 20],
      [3, 45, 15, 13, 46, 16],

      // 17
      [1, 135, 107, 5, 136, 108],
      [10, 74, 46, 1, 75, 47],
      [1, 50, 22, 15, 51, 23],
      [2, 42, 14, 17, 43, 15],

      // 18
      [5, 150, 120, 1, 151, 121],
      [9, 69, 43, 4, 70, 44],
      [17, 50, 22, 1, 51, 23],
      [2, 42, 14, 19, 43, 15],

      // 19
      [3, 141, 113, 4, 142, 114],
      [3, 70, 44, 11, 71, 45],
      [17, 47, 21, 4, 48, 22],
      [9, 39, 13, 16, 40, 14],

      // 20
      [3, 135, 107, 5, 136, 108],
      [3, 67, 41, 13, 68, 42],
      [15, 54, 24, 5, 55, 25],
      [15, 43, 15, 10, 44, 16],

      // 21
      [4, 144, 116, 4, 145, 117],
      [17, 68, 42],
      [17, 50, 22, 6, 51, 23],
      [19, 46, 16, 6, 47, 17],

      // 22
      [2, 139, 111, 7, 140, 112],
      [17, 74, 46],
      [7, 54, 24, 16, 55, 25],
      [34, 37, 13],

      // 23
      [4, 151, 121, 5, 152, 122],
      [4, 75, 47, 14, 76, 48],
      [11, 54, 24, 14, 55, 25],
      [16, 45, 15, 14, 46, 16],

      // 24
      [6, 147, 117, 4, 148, 118],
      [6, 73, 45, 14, 74, 46],
      [11, 54, 24, 16, 55, 25],
      [30, 46, 16, 2, 47, 17],

      // 25
      [8, 132, 106, 4, 133, 107],
      [8, 75, 47, 13, 76, 48],
      [7, 54, 24, 22, 55, 25],
      [22, 45, 15, 13, 46, 16],

      // 26
      [10, 142, 114, 2, 143, 115],
      [19, 74, 46, 4, 75, 47],
      [28, 50, 22, 6, 51, 23],
      [33, 46, 16, 4, 47, 17],

      // 27
      [8, 152, 122, 4, 153, 123],
      [22, 73, 45, 3, 74, 46],
      [8, 53, 23, 26, 54, 24],
      [12, 45, 15, 28, 46, 16],

      // 28
      [3, 147, 117, 10, 148, 118],
      [3, 73, 45, 23, 74, 46],
      [4, 54, 24, 31, 55, 25],
      [11, 45, 15, 31, 46, 16],

      // 29
      [7, 146, 116, 7, 147, 117],
      [21, 73, 45, 7, 74, 46],
      [1, 53, 23, 37, 54, 24],
      [19, 45, 15, 26, 46, 16],

      // 30
      [5, 145, 115, 10, 146, 116],
      [19, 75, 47, 10, 76, 48],
      [15, 54, 24, 25, 55, 25],
      [23, 45, 15, 25, 46, 16],

      // 31
      [13, 145, 115, 3, 146, 116],
      [2, 74, 46, 29, 75, 47],
      [42, 54, 24, 1, 55, 25],
      [23, 45, 15, 28, 46, 16],

      // 32
      [17, 145, 115],
      [10, 74, 46, 23, 75, 47],
      [10, 54, 24, 35, 55, 25],
      [19, 45, 15, 35, 46, 16],

      // 33
      [17, 145, 115, 1, 146, 116],
      [14, 74, 46, 21, 75, 47],
      [29, 54, 24, 19, 55, 25],
      [11, 45, 15, 46, 46, 16],

      // 34
      [13, 145, 115, 6, 146, 116],
      [14, 74, 46, 23, 75, 47],
      [44, 54, 24, 7, 55, 25],
      [59, 46, 16, 1, 47, 17],

      // 35
      [12, 151, 121, 7, 152, 122],
      [12, 75, 47, 26, 76, 48],
      [39, 54, 24, 14, 55, 25],
      [22, 45, 15, 41, 46, 16],

      // 36
      [6, 151, 121, 14, 152, 122],
      [6, 75, 47, 34, 76, 48],
      [46, 54, 24, 10, 55, 25],
      [2, 45, 15, 64, 46, 16],

      // 37
      [17, 152, 122, 4, 153, 123],
      [29, 74, 46, 14, 75, 47],
      [49, 54, 24, 10, 55, 25],
      [24, 45, 15, 46, 46, 16],

      // 38
      [4, 152, 122, 18, 153, 123],
      [13, 74, 46, 32, 75, 47],
      [48, 54, 24, 14, 55, 25],
      [42, 45, 15, 32, 46, 16],

      // 39
      [20, 147, 117, 4, 148, 118],
      [40, 75, 47, 7, 76, 48],
      [43, 54, 24, 22, 55, 25],
      [10, 45, 15, 67, 46, 16],

      // 40
      [19, 148, 118, 6, 149, 119],
      [18, 75, 47, 31, 76, 48],
      [34, 54, 24, 34, 55, 25],
      [20, 45, 15, 61, 46, 16]
    ];

    var qrRSBlock = function(totalCount, dataCount) {
      var _this = {};
      _this.totalCount = totalCount;
      _this.dataCount = dataCount;
      return _this;
    };

    var _this = {};

    var getRsBlockTable = function(typeNumber, errorCorrectionLevel) {

      switch(errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default :
        return undefined;
      }
    };

    _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {

      var rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);

      if (typeof rsBlock == 'undefined') {
        throw 'bad rs block @ typeNumber:' + typeNumber +
            '/errorCorrectionLevel:' + errorCorrectionLevel;
      }

      var length = rsBlock.length / 3;

      var list = [];

      for (var i = 0; i < length; i += 1) {

        var count = rsBlock[i * 3 + 0];
        var totalCount = rsBlock[i * 3 + 1];
        var dataCount = rsBlock[i * 3 + 2];

        for (var j = 0; j < count; j += 1) {
          list.push(qrRSBlock(totalCount, dataCount) );
        }
      }

      return list;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrBitBuffer
  //---------------------------------------------------------------------

  var qrBitBuffer = function() {

    var _buffer = [];
    var _length = 0;

    var _this = {};

    _this.getBuffer = function() {
      return _buffer;
    };

    _this.getAt = function(index) {
      var bufIndex = Math.floor(index / 8);
      return ( (_buffer[bufIndex] >>> (7 - index % 8) ) & 1) == 1;
    };

    _this.put = function(num, length) {
      for (var i = 0; i < length; i += 1) {
        _this.putBit( ( (num >>> (length - i - 1) ) & 1) == 1);
      }
    };

    _this.getLengthInBits = function() {
      return _length;
    };

    _this.putBit = function(bit) {

      var bufIndex = Math.floor(_length / 8);
      if (_buffer.length <= bufIndex) {
        _buffer.push(0);
      }

      if (bit) {
        _buffer[bufIndex] |= (0x80 >>> (_length % 8) );
      }

      _length += 1;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrNumber
  //---------------------------------------------------------------------

  var qrNumber = function(data) {

    var _mode = QRMode.MODE_NUMBER;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var data = _data;

      var i = 0;

      while (i + 2 < data.length) {
        buffer.put(strToNum(data.substring(i, i + 3) ), 10);
        i += 3;
      }

      if (i < data.length) {
        if (data.length - i == 1) {
          buffer.put(strToNum(data.substring(i, i + 1) ), 4);
        } else if (data.length - i == 2) {
          buffer.put(strToNum(data.substring(i, i + 2) ), 7);
        }
      }
    };

    var strToNum = function(s) {
      var num = 0;
      for (var i = 0; i < s.length; i += 1) {
        num = num * 10 + chatToNum(s.charAt(i) );
      }
      return num;
    };

    var chatToNum = function(c) {
      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      }
      throw 'illegal char :' + c;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrAlphaNum
  //---------------------------------------------------------------------

  var qrAlphaNum = function(data) {

    var _mode = QRMode.MODE_ALPHA_NUM;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var s = _data;

      var i = 0;

      while (i + 1 < s.length) {
        buffer.put(
          getCode(s.charAt(i) ) * 45 +
          getCode(s.charAt(i + 1) ), 11);
        i += 2;
      }

      if (i < s.length) {
        buffer.put(getCode(s.charAt(i) ), 6);
      }
    };

    var getCode = function(c) {

      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      } else if ('A' <= c && c <= 'Z') {
        return c.charCodeAt(0) - 'A'.charCodeAt(0) + 10;
      } else {
        switch (c) {
        case ' ' : return 36;
        case '$' : return 37;
        case '%' : return 38;
        case '*' : return 39;
        case '+' : return 40;
        case '-' : return 41;
        case '.' : return 42;
        case '/' : return 43;
        case ':' : return 44;
        default :
          throw 'illegal char :' + c;
        }
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qr8BitByte
  //---------------------------------------------------------------------

  var qr8BitByte = function(data) {

    var _mode = QRMode.MODE_8BIT_BYTE;
    var _data = data;
    var _bytes = qrcode.stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _bytes.length;
    };

    _this.write = function(buffer) {
      for (var i = 0; i < _bytes.length; i += 1) {
        buffer.put(_bytes[i], 8);
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrKanji
  //---------------------------------------------------------------------

  var qrKanji = function(data) {

    var _mode = QRMode.MODE_KANJI;
    var _data = data;

    var stringToBytes = qrcode.stringToBytesFuncs['SJIS'];
    if (!stringToBytes) {
      throw 'sjis not supported.';
    }
    !function(c, code) {
      // self test for sjis support.
      var test = stringToBytes(c);
      if (test.length != 2 || ( (test[0] << 8) | test[1]) != code) {
        throw 'sjis not supported.';
      }
    }('\u53cb', 0x9746);

    var _bytes = stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return ~~(_bytes.length / 2);
    };

    _this.write = function(buffer) {

      var data = _bytes;

      var i = 0;

      while (i + 1 < data.length) {

        var c = ( (0xff & data[i]) << 8) | (0xff & data[i + 1]);

        if (0x8140 <= c && c <= 0x9FFC) {
          c -= 0x8140;
        } else if (0xE040 <= c && c <= 0xEBBF) {
          c -= 0xC140;
        } else {
          throw 'illegal char at ' + (i + 1) + '/' + c;
        }

        c = ( (c >>> 8) & 0xff) * 0xC0 + (c & 0xff);

        buffer.put(c, 13);

        i += 2;
      }

      if (i < data.length) {
        throw 'illegal char at ' + (i + 1);
      }
    };

    return _this;
  };

  //=====================================================================
  // GIF Support etc.
  //

  //---------------------------------------------------------------------
  // byteArrayOutputStream
  //---------------------------------------------------------------------

  var byteArrayOutputStream = function() {

    var _bytes = [];

    var _this = {};

    _this.writeByte = function(b) {
      _bytes.push(b & 0xff);
    };

    _this.writeShort = function(i) {
      _this.writeByte(i);
      _this.writeByte(i >>> 8);
    };

    _this.writeBytes = function(b, off, len) {
      off = off || 0;
      len = len || b.length;
      for (var i = 0; i < len; i += 1) {
        _this.writeByte(b[i + off]);
      }
    };

    _this.writeString = function(s) {
      for (var i = 0; i < s.length; i += 1) {
        _this.writeByte(s.charCodeAt(i) );
      }
    };

    _this.toByteArray = function() {
      return _bytes;
    };

    _this.toString = function() {
      var s = '';
      s += '[';
      for (var i = 0; i < _bytes.length; i += 1) {
        if (i > 0) {
          s += ',';
        }
        s += _bytes[i];
      }
      s += ']';
      return s;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64EncodeOutputStream
  //---------------------------------------------------------------------

  var base64EncodeOutputStream = function() {

    var _buffer = 0;
    var _buflen = 0;
    var _length = 0;
    var _base64 = '';

    var _this = {};

    var writeEncoded = function(b) {
      _base64 += String.fromCharCode(encode(b & 0x3f) );
    };

    var encode = function(n) {
      if (n < 0) {
        // error.
      } else if (n < 26) {
        return 0x41 + n;
      } else if (n < 52) {
        return 0x61 + (n - 26);
      } else if (n < 62) {
        return 0x30 + (n - 52);
      } else if (n == 62) {
        return 0x2b;
      } else if (n == 63) {
        return 0x2f;
      }
      throw 'n:' + n;
    };

    _this.writeByte = function(n) {

      _buffer = (_buffer << 8) | (n & 0xff);
      _buflen += 8;
      _length += 1;

      while (_buflen >= 6) {
        writeEncoded(_buffer >>> (_buflen - 6) );
        _buflen -= 6;
      }
    };

    _this.flush = function() {

      if (_buflen > 0) {
        writeEncoded(_buffer << (6 - _buflen) );
        _buffer = 0;
        _buflen = 0;
      }

      if (_length % 3 != 0) {
        // padding
        var padlen = 3 - _length % 3;
        for (var i = 0; i < padlen; i += 1) {
          _base64 += '=';
        }
      }
    };

    _this.toString = function() {
      return _base64;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64DecodeInputStream
  //---------------------------------------------------------------------

  var base64DecodeInputStream = function(str) {

    var _str = str;
    var _pos = 0;
    var _buffer = 0;
    var _buflen = 0;

    var _this = {};

    _this.read = function() {

      while (_buflen < 8) {

        if (_pos >= _str.length) {
          if (_buflen == 0) {
            return -1;
          }
          throw 'unexpected end of file./' + _buflen;
        }

        var c = _str.charAt(_pos);
        _pos += 1;

        if (c == '=') {
          _buflen = 0;
          return -1;
        } else if (c.match(/^\s$/) ) {
          // ignore if whitespace.
          continue;
        }

        _buffer = (_buffer << 6) | decode(c.charCodeAt(0) );
        _buflen += 6;
      }

      var n = (_buffer >>> (_buflen - 8) ) & 0xff;
      _buflen -= 8;
      return n;
    };

    var decode = function(c) {
      if (0x41 <= c && c <= 0x5a) {
        return c - 0x41;
      } else if (0x61 <= c && c <= 0x7a) {
        return c - 0x61 + 26;
      } else if (0x30 <= c && c <= 0x39) {
        return c - 0x30 + 52;
      } else if (c == 0x2b) {
        return 62;
      } else if (c == 0x2f) {
        return 63;
      } else {
        throw 'c:' + c;
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // gifImage (B/W)
  //---------------------------------------------------------------------

  var gifImage = function(width, height) {

    var _width = width;
    var _height = height;
    var _data = new Array(width * height);

    var _this = {};

    _this.setPixel = function(x, y, pixel) {
      _data[y * _width + x] = pixel;
    };

    _this.write = function(out) {

      //---------------------------------
      // GIF Signature

      out.writeString('GIF87a');

      //---------------------------------
      // Screen Descriptor

      out.writeShort(_width);
      out.writeShort(_height);

      out.writeByte(0x80); // 2bit
      out.writeByte(0);
      out.writeByte(0);

      //---------------------------------
      // Global Color Map

      // black
      out.writeByte(0x00);
      out.writeByte(0x00);
      out.writeByte(0x00);

      // white
      out.writeByte(0xff);
      out.writeByte(0xff);
      out.writeByte(0xff);

      //---------------------------------
      // Image Descriptor

      out.writeString(',');
      out.writeShort(0);
      out.writeShort(0);
      out.writeShort(_width);
      out.writeShort(_height);
      out.writeByte(0);

      //---------------------------------
      // Local Color Map

      //---------------------------------
      // Raster Data

      var lzwMinCodeSize = 2;
      var raster = getLZWRaster(lzwMinCodeSize);

      out.writeByte(lzwMinCodeSize);

      var offset = 0;

      while (raster.length - offset > 255) {
        out.writeByte(255);
        out.writeBytes(raster, offset, 255);
        offset += 255;
      }

      out.writeByte(raster.length - offset);
      out.writeBytes(raster, offset, raster.length - offset);
      out.writeByte(0x00);

      //---------------------------------
      // GIF Terminator
      out.writeString(';');
    };

    var bitOutputStream = function(out) {

      var _out = out;
      var _bitLength = 0;
      var _bitBuffer = 0;

      var _this = {};

      _this.write = function(data, length) {

        if ( (data >>> length) != 0) {
          throw 'length over';
        }

        while (_bitLength + length >= 8) {
          _out.writeByte(0xff & ( (data << _bitLength) | _bitBuffer) );
          length -= (8 - _bitLength);
          data >>>= (8 - _bitLength);
          _bitBuffer = 0;
          _bitLength = 0;
        }

        _bitBuffer = (data << _bitLength) | _bitBuffer;
        _bitLength = _bitLength + length;
      };

      _this.flush = function() {
        if (_bitLength > 0) {
          _out.writeByte(_bitBuffer);
        }
      };

      return _this;
    };

    var getLZWRaster = function(lzwMinCodeSize) {

      var clearCode = 1 << lzwMinCodeSize;
      var endCode = (1 << lzwMinCodeSize) + 1;
      var bitLength = lzwMinCodeSize + 1;

      // Setup LZWTable
      var table = lzwTable();

      for (var i = 0; i < clearCode; i += 1) {
        table.add(String.fromCharCode(i) );
      }
      table.add(String.fromCharCode(clearCode) );
      table.add(String.fromCharCode(endCode) );

      var byteOut = byteArrayOutputStream();
      var bitOut = bitOutputStream(byteOut);

      // clear code
      bitOut.write(clearCode, bitLength);

      var dataIndex = 0;

      var s = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;

      while (dataIndex < _data.length) {

        var c = String.fromCharCode(_data[dataIndex]);
        dataIndex += 1;

        if (table.contains(s + c) ) {

          s = s + c;

        } else {

          bitOut.write(table.indexOf(s), bitLength);

          if (table.size() < 0xfff) {

            if (table.size() == (1 << bitLength) ) {
              bitLength += 1;
            }

            table.add(s + c);
          }

          s = c;
        }
      }

      bitOut.write(table.indexOf(s), bitLength);

      // end code
      bitOut.write(endCode, bitLength);

      bitOut.flush();

      return byteOut.toByteArray();
    };

    var lzwTable = function() {

      var _map = {};
      var _size = 0;

      var _this = {};

      _this.add = function(key) {
        if (_this.contains(key) ) {
          throw 'dup key:' + key;
        }
        _map[key] = _size;
        _size += 1;
      };

      _this.size = function() {
        return _size;
      };

      _this.indexOf = function(key) {
        return _map[key];
      };

      _this.contains = function(key) {
        return typeof _map[key] != 'undefined';
      };

      return _this;
    };

    return _this;
  };

  var createDataURL = function(width, height, getPixel) {
    var gif = gifImage(width, height);
    for (var y = 0; y < height; y += 1) {
      for (var x = 0; x < width; x += 1) {
        gif.setPixel(x, y, getPixel(x, y) );
      }
    }

    var b = byteArrayOutputStream();
    gif.write(b);

    var base64 = base64EncodeOutputStream();
    var bytes = b.toByteArray();
    for (var i = 0; i < bytes.length; i += 1) {
      base64.writeByte(bytes[i]);
    }
    base64.flush();

    return 'data:image/gif;base64,' + base64;
  };

  //---------------------------------------------------------------------
  // returns qrcode function.

  return qrcode;
}();

// multibyte support
!function() {

  qrcode.stringToBytesFuncs['UTF-8'] = function(s) {
    // http://stackoverflow.com/questions/18729405/how-to-convert-utf8-string-to-byte-array
    function toUTF8Array(str) {
      var utf8 = [];
      for (var i=0; i < str.length; i++) {
        var charcode = str.charCodeAt(i);
        if (charcode < 0x80) utf8.push(charcode);
        else if (charcode < 0x800) {
          utf8.push(0xc0 | (charcode >> 6),
              0x80 | (charcode & 0x3f));
        }
        else if (charcode < 0xd800 || charcode >= 0xe000) {
          utf8.push(0xe0 | (charcode >> 12),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
        // surrogate pair
        else {
          i++;
          // UTF-16 encodes 0x10000-0x10FFFF by
          // subtracting 0x10000 and splitting the
          // 20 bits of 0x0-0xFFFFF into two halves
          charcode = 0x10000 + (((charcode & 0x3ff)<<10)
            | (str.charCodeAt(i) & 0x3ff));
          utf8.push(0xf0 | (charcode >>18),
              0x80 | ((charcode>>12) & 0x3f),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
      }
      return utf8;
    }
    return toUTF8Array(s);
  };

}();

(function (factory) {
  if (typeof define === 'function' && define.amd) {
      define([], factory);
  } else if (typeof exports === 'object') {
      module.exports = factory();
  }
}(function () {
    return qrcode;
}));

  var _qr = (typeof qrcode !== 'undefined') ? qrcode : module.exports;
  if (typeof _qr === 'function') window.__ptx7QR = _qr;
})();

/*
 * PTX7 PIMS Receiving Mode — injected overlay
 * -------------------------------------------------
 * A simplified, large-button receiving flow driven by the device's
 * built-in hardware (keyboard-wedge) scanner. Camera is not used here.
 *
 * Flow:
 *   1. SCAN NDC            -> read PIMS "Incoming Purchases" POs for that NDC
 *   2. TAP the correct PO  -> navigate PIMS into that PO's receive page
 *   3. SCAN MEDICATION     -> confirm it matches the chosen NDC
 *   4. SCAN LOCATION       -> confirm, show PUT AWAY, loop to step 1
 *
 * The operator can EXIT TO PIMS at any time to use the raw page.
 *
 * This script is intentionally self-contained and namespaced under
 * window.__ptx7Rx so it never collides with the existing mobile-UI
 * enhancement injection.
 */
(function () {
  'use strict';

  if (window.__ptx7RxInstalled) {
    // Already installed on this document. Just make sure it is showing if
    // Android asked us to (re)open it.
    if (window.__ptx7RxReopen) window.__ptx7Rx.open();
    return;
  }
  window.__ptx7RxInstalled = true;

  // ---------------------------------------------------------------------------
  // Small helpers (ported/condensed from the v2.26.1 Tampermonkey assistant)
  // ---------------------------------------------------------------------------
  var INVENTORY_URL = 'https://console.inventory.pharmacy.amazon.dev/inventory?facility=PTX7';

  function digitsOnly(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------------------------------------------------------------------------
  // SPEED RECEIVE (added in beta21)
  // When ON, each PIMS-suggested location during RECEIVE is shown as a big
  // quadrant-colored (Q1-Q4 / COLD / WORKSTATION) card with a scannable QR of
  // the bare location string, so the operator scans it off the PM86 to proceed.
  // This is a display accelerator only; it never changes PIMS or the scanner
  // capture/delivery path.
  // ---------------------------------------------------------------------------
  var SPEED_RECEIVE_KEY = 'ptx7_rx_speed_receive';
  function speedReceiveOn() {
    try { return localStorage.getItem(SPEED_RECEIVE_KEY) !== 'false'; } catch (e) { return true; }
  }
  function setSpeedReceive(on) {
    try { localStorage.setItem(SPEED_RECEIVE_KEY, on ? 'true' : 'false'); } catch (e) {}
  }

  // Section number from a PTX7 location code (MANFW0105-C-10 -> 105).
  function rxSection(loc) {
    var m = String(loc || '').toUpperCase().match(/^MAN[A-Z]*0*(10[1-9]|11[0-9]|120)(?:-|$)/);
    return m ? Number(m[1]) : null;
  }
  // Quadrant/zone for a location (ranges confirmed with PTX7).
  function zoneFor(loc) {
    var u = String(loc || '').toUpperCase();
    if (u.indexOf('CLD') === 0) return 'COLD';
    if (u.indexOf('MANWS') === 0) return 'WORKSTATION';
    if (u.indexOf('MANFW') !== 0) return '\u2014';
    var n = rxSection(u);
    if (n >= 101 && n <= 105) return 'Q1';
    if ([109, 110, 114, 115, 116, 117].indexOf(n) >= 0) return 'Q2';
    if (n >= 106 && n <= 108) return 'Q3';
    if ([111, 112, 113, 118, 119, 120].indexOf(n) >= 0) return 'Q4';
    return '\u2014';
  }
  function zoneColor(z) {
    return {
      Q1: '#0B9854', Q2: '#D9272E', Q3: '#087CC1', Q4: '#E87511',
      COLD: '#635BFF', WORKSTATION: '#6B7280'
    }[z] || '#5f6872';
  }
  // Human-readable breakdown for the card hint ("Section 105 · Row C · Pos 10").
  function zoneHint(loc) {
    var m = String(loc || '').toUpperCase().match(/^(?:MAN(?:FW|WS)?|CLD[A-Z]*)0*(\d{3})-([A-Z])-(\d{1,2})$/);
    if (!m) return '';
    return 'Section ' + m[1] + ' \u00b7 Row ' + m[2] + ' \u00b7 Pos ' + Number(m[3]);
  }

  // Draw a QR of `text` into a canvas using the bundled offline encoder
  // (window.__ptx7QR, prepended to this file). Falls back to plain text.
  function drawLocationQr(canvas, text) {
    try {
      if (!window.__ptx7QR) throw new Error('QR encoder missing');
      var qr = window.__ptx7QR(0, 'L');
      qr.addData(String(text));
      qr.make();
      var count = qr.getModuleCount();
      var size = canvas.width;
      var cell = Math.floor(size / (count + 2));
      var pad = Math.floor((size - cell * count) / 2);
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#000';
      for (var r = 0; r < count; r++) {
        for (var c = 0; c < count; c++) {
          if (qr.isDark(r, c)) ctx.fillRect(pad + c * cell, pad + r * cell, cell, cell);
        }
      }
      return true;
    } catch (e) { return false; }
  }

  // ---------------------------------------------------------------------------
  // NDC resolution (ported from the PTX7 Apps Script Exception tool, which has
  // field-proven UPC/GS1/GTIN handling). Turns a raw scan into a canonical
  // 11-digit NDC so Step 1 (NDC capture) and Step 3 (medication match) are
  // reliable regardless of UPC/GTIN packaging and check digits.
  // ---------------------------------------------------------------------------

  // UPC-A drug barcode: 3 + 10-digit NDC payload + UPC check digit.
  // Example 300021495800 -> payload 0002149580 -> NDC-11 00002149580.
  function deriveNdcFromUpcDrugBarcode(barcode) {
    var d = digitsOnly(barcode);
    var ndc10 = '';
    if (d.length === 12 && d.charAt(0) === '3') ndc10 = d.slice(1, 11);
    if (!ndc10 && d.length === 13 && d.slice(0, 2) === '03') ndc10 = d.slice(2, 12);
    if (ndc10.length !== 10) return '';
    return '0' + ndc10.slice(0, 4) + ndc10.slice(4, 8) + ndc10.slice(8, 10);
  }

  function deriveNdcFromGtin(gtin) {
    var d = digitsOnly(gtin);
    if (d.length !== 14) return '';
    // Many pharmacy GTIN-14 values are 00 + UPC-A drug barcode.
    if (d.slice(0, 2) === '00') {
      var fromUpc = deriveNdcFromUpcDrugBarcode(d.slice(2, 14));
      if (fromUpc) return fromUpc;
    }
    var candidates = [d.slice(2, 13), d.slice(1, 12), d.slice(3, 14), d.slice(0, 11)];
    for (var i = 0; i < candidates.length; i++) {
      if (/^\d{11}$/.test(candidates[i])) return candidates[i];
    }
    return '';
  }

  // Resolve any raw NDC/UPC/GTIN form to a canonical 11-digit NDC.
  function resolveNdc11(raw) {
    var cleaned = String(raw == null ? '' : raw).trim();

    // Dashed NDC: segment lengths tell us the exact padding.
    var dash = cleaned.match(/^(\d+)-(\d+)-(\d+)$/);
    if (dash) {
      var s1 = dash[1], s2 = dash[2], s3 = dash[3];
      var total = s1.length + s2.length + s3.length;
      if (total === 11) return s1 + s2 + s3;
      if (total === 10) {
        if (s1.length === 4) return '0' + s1 + s2 + s3;      // 4-4-2
        if (s2.length === 3) return s1 + '0' + s2 + s3;      // 5-3-2
        if (s3.length === 1) return s1 + s2 + '0' + s3;      // 5-4-1
      }
    }

    var d = digitsOnly(cleaned);
    if (!d) return '';
    if (d.length === 11) return d;
    if (d.length === 9) return '00' + d; // recover zeros stripped elsewhere
    if (d.length === 10) return '0' + d.slice(0, 4) + d.slice(4, 8) + d.slice(8, 10); // default 4-4-2
    if (d.length === 12) { var u12 = deriveNdcFromUpcDrugBarcode(d); return u12 || d.slice(1); }
    if (d.length === 13) { var u13 = deriveNdcFromUpcDrugBarcode(d); return u13 || d.slice(2); }
    if (d.length === 14) return deriveNdcFromGtin(d);
    return '';
  }

  // Compact GS1 (01=GTIN, 21=serial, 17=exp, 10=lot) with no separators.
  // Returns the embedded NDC-11 if present.
  function ndcFromCompactGs1(raw) {
    var s = String(raw == null ? '' : raw).replace(/\s+/g, '').replace(/\|/g, '');
    var m = s.match(/^01(\d{14})/);
    if (!m) return '';
    return deriveNdcFromGtin(m[1]);
  }

  // All plausible canonical NDC-11 forms for a raw scan (handles the ambiguous
  // undashed 10-digit case by trying 4-4-2 / 5-3-2 / 5-4-1).
  function ndc11Variants(raw) {
    var out = [];
    var seen = {};
    function add(v) {
      v = digitsOnly(v);
      if (v && v.length === 11 && !seen[v]) { seen[v] = true; out.push(v); }
    }
    add(resolveNdc11(raw));
    add(ndcFromCompactGs1(raw));
    var d = digitsOnly(raw);
    if (d.length === 10) {
      add('0' + d.slice(0, 4) + d.slice(4, 8) + d.slice(8, 10)); // 4-4-2
      add(d.slice(0, 5) + '0' + d.slice(5, 8) + d.slice(8, 10)); // 5-3-2
      add(d.slice(0, 5) + d.slice(5, 9) + '0' + d.slice(9, 10)); // 5-4-1
    }
    return out;
  }

  // Primary helper: the single best canonical NDC-11 for a scan (or '').
  function scanToNdc11(raw) {
    var v = ndc11Variants(raw);
    return v.length ? v[0] : '';
  }

  // Match a scanned barcode against a known/stored NDC using canonical NDC-11
  // on both sides. Returns a 0..100 confidence score.
  function ndcMatchScore(stored, scanned) {
    var storedForms = ndc11Variants(stored);
    var scanForms = ndc11Variants(scanned);
    if (!storedForms.length || !scanForms.length) {
      // Fall back to raw digit equality if neither side resolves to NDC-11.
      var a = digitsOnly(stored), b = digitsOnly(scanned);
      if (a && b && a === b) return 100;
      if (a && b && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0)) return 90;
      return 0;
    }
    for (var i = 0; i < storedForms.length; i++) {
      for (var j = 0; j < scanForms.length; j++) {
        if (storedForms[i] === scanForms[j]) return 100;
      }
    }
    // Same 10-digit product prefix, differing package digit.
    for (var x = 0; x < storedForms.length; x++) {
      for (var y = 0; y < scanForms.length; y++) {
        if (storedForms[x].slice(0, 10) === scanForms[y].slice(0, 10)) return 92;
      }
    }
    return 0;
  }
  function ndcComparable(stored, scanned) { return ndcMatchScore(stored, scanned) >= 90; }

  function normalizedLabel(v) { return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]/g, ''); }

  function pageText() { return String((document.body && document.body.innerText) || ''); }

  // Current NDC shown on the PIMS inventory result, if any.
  function currentResultNdc() {
    var m = pageText().match(/\bNDC\s*-\s*(\d{9,14})\b/i);
    return m ? m[1] : '';
  }

  // The drug name heading on the PIMS inventory result (e.g.
  // "Xiromed Progesterone 100 Mg Cap (bottle, 100.0 Capsules)").
  function currentResultDrug() {
    var hs = [].slice.call(document.querySelectorAll('h1,h2,h3,h4,[role="heading"]'))
      .filter(function (el) { return !(el.closest && el.closest('#ptx7-rx-root')); })
      .map(function (el) { return String(el.textContent || '').replace(/\s+/g, ' ').trim(); })
      .filter(function (t) {
        return t && !/^inventory$/i.test(t) && !/pharmacy inventory management console|incoming purchases|transaction history/i.test(t);
      });
    return hs[0] || '';
  }

  // ---- PO receiving-page readers -------------------------------------------
  // These read the live PIMS "Receiving" page so the overlay can mirror it.

  // True when PIMS is showing a PO receiving page (not the Inventory lookup).
  // Markers seen on that page: "Receiving in progress", the Unreceived/Received
  // tabs, "Search by Product Id", "Manually Receive Item", or a PO + Status.
  function onReceivingPage() {
    var t = pageText();
    if (/Receiving in progress/i.test(t)) return true;
    if (/Manually Receive Item/i.test(t)) return true;
    if (/Unreceived\s*\d+\s*\/\s*\d+/i.test(t)) return true;
    if (/Back to all Purchase Orders/i.test(t)) return true;
    if (/Scan Location to submit receives/i.test(t)) return true;
    return false;
  }

  // The PO number heading (e.g. "3XX63W4G") and status line.
  function currentPo() {
    var t = pageText();
    // Status: OPEN RECEIVABLE appears right under the PO heading.
    var m = t.match(/\b([A-Z0-9]{6,10})\s+Status:\s*(OPEN|CLOSED|NOT STARTED)/i);
    if (m) return m[1];
    // Fallback: a short heading near "Status: ... RECEIVABLE".
    var hs = [].slice.call(document.querySelectorAll('h1,h2,h3'))
      .filter(function (el) { return !(el.closest && el.closest('#ptx7-rx-root')); })
      .map(function (el) { return String(el.textContent || '').trim(); })
      .filter(function (s) { return /^[A-Z0-9]{6,10}$/.test(s); });
    return hs[0] || '';
  }

  // "Receiving in progress: 48/110" -> { received, total } if present.
  function currentProgress() {
    var m = pageText().match(/Receiving in progress:\s*(\d+)\s*\/\s*(\d+)/i);
    return m ? { received: m[1], total: m[2] } : null;
  }

  // When a drug has been scanned on the receiving page, PIMS shows a detail
  // panel that says "Scan Location to submit receives" with the drug, NDC, and
  // Suggested Locations. Returns that info, or null when no drug is pending.
  function allLocationsIn(text) {
    var found = {};
    (String(text || '').toUpperCase().match(/\b(?:MAN(?:FW|WS)?|CLD[A-Z]*)\d{3,5}-[A-Z]-\d{1,2}\b/g) || [])
      .forEach(function(location){ found[location] = true; });
    return Object.keys(found).sort(function(a,b){ return a.localeCompare(b,undefined,{numeric:true}); });
  }

  function parseQuantityPair(value) {
    var match = String(value || '').match(/(\d+)\s*\((\d+)\)/);
    return match ? { pkgs:Number(match[1]), units:Number(match[2]) } : null;
  }

  function readTableByHeaders(table) {
    if (!table) return [];
    var headers = [].slice.call(table.querySelectorAll('thead th'));
    if (!headers.length) headers = [].slice.call(table.querySelectorAll('tr:first-child th,tr:first-child td'));
    var keys = headers.map(function(header){ return String(header.innerText || '').replace(/\s+/g,' ').trim().toLowerCase(); });
    return [].slice.call(table.querySelectorAll('tbody tr')).map(function(row){
      var result = {}, cells = [].slice.call(row.querySelectorAll(':scope > td,:scope > th'));
      cells.forEach(function(cell,index){ result[keys[index] || ('col'+index)] = cell; });
      return result;
    });
  }

  function panelQuantity(scopeText,label) {
    var match = String(scopeText || '').match(new RegExp(label + '\\s*:?\\s*(\\d+)\\s*\\((\\d+)\\)','i'));
    return match ? { pkgs:Number(match[1]), units:Number(match[2]) } : null;
  }

  // Read only the active PIMS receive dialog, then match its Product Id to the
  // side panel before using quantities/package details. Never use stale page text.
  function currentReceiveDetail() {
    var marker = /Complete receive before proceeding to next NDC|Scan Location to submit receives/i;
    var dialog = [].slice.call(document.querySelectorAll('[role="dialog"],[role="alertdialog"]'))
      .filter(function(element){ return !(element.closest && element.closest('#ptx7-rx-root')); })
      .find(function(element){ return marker.test(element.textContent || ''); });
    if (!dialog) return null;

    var rowObjects = [];
    [].slice.call(dialog.querySelectorAll('table')).forEach(function(table){ rowObjects = rowObjects.concat(readTableByHeaders(table)); });
    var pending = rowObjects.find(function(row){
      var cell = row['product id'] || row.productid || row.product;
      return cell && /\d{6,}/.test(cell.innerText || '');
    });
    if (!pending) return null;

    var productCell = pending['product id'] || pending.productid || pending.product;
    var productId = String(productCell.innerText || '').replace(/\D/g,'');
    var descriptionCell = pending.description || pending.desc;
    var drug = descriptionCell ? String(descriptionCell.innerText || '').replace(/\s+/g,' ').trim() : '';
    var scannedCell = pending['currently scanned'] || pending.scanned;
    var scanned = scannedCell ? parseQuantityPair(scannedCell.innerText) : null;
    var locationsCell = pending['suggested locations'] || pending['suggested location'] || pending.locations;
    var locations = locationsCell ? allLocationsIn(locationsCell.innerText) : [];
    if (!locations.length) locations = allLocationsIn(dialog.innerText);

    var ordered = null, received = null, packageSize = 0, unitWord = 'units', warnings = [];
    var sidePanels = [].slice.call(document.querySelectorAll('aside,section,div'))
      .filter(function(element){
        if (element.closest && element.closest('#ptx7-rx-root')) return false;
        var text = element.innerText || '';
        return productId && text.indexOf(productId) >= 0 && /Quantity (Ordered|Received)/i.test(text);
      })
      .sort(function(a,b){ return (a.innerText || '').length - (b.innerText || '').length; });
    if (sidePanels.length) {
      var sideText = String(sidePanels[0].innerText || '').replace(/\u00a0/g,' ');
      ordered = panelQuantity(sideText,'Quantity Ordered');
      received = panelQuantity(sideText,'Quantity Received');
      var packageMatch = sideText.match(/Package Size\s*:?\s*(\d+(?:\.\d+)?)/i);
      if (packageMatch) packageSize = Number(packageMatch[1]);
      var unitMatch = sideText.match(/\d+\.?\d*\s*(Capsules?|Tablets?|Milliliters?|mL|Grams?|Each|Units?|Inhalers?|Sprays?)/i);
      if (unitMatch) unitWord = unitMatch[1].toLowerCase();
      if (/hazardous drug|special handling|N\s*Listed Hazard/i.test(sideText)) warnings.push('HAZARDOUS — Special Handling');
      if (/cold chain|refrigerat/i.test(sideText)) warnings.push('COLD CHAIN');
      if (!drug) {
        var descriptionMatch = sideText.match(/([A-Z0-9][^\n]*?\((?:bottle|box|container|tube|each|carton)[^\n]*?\))/i);
        if (descriptionMatch) drug = descriptionMatch[1].replace(/\s+/g,' ').trim();
      }
    }
    if (!packageSize && scanned && scanned.pkgs > 0) packageSize = scanned.units / scanned.pkgs;
    return {
      ndc:productId, drug:drug, location:locations[0] || '', locations:locations,
      ordered:ordered, received:received, scanned:scanned, pkgSize:packageSize,
      unitWord:unitWord, warnings:warnings, key:productId
    };
  }

  // ---- PO reading (condensed from readIncomingPurchaseOrders) ---------------
  function incomingPurchasesRoot() {
    var headings = [].slice.call(document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,span'))
      .filter(function (el) { return String(el.textContent || '').trim().toLowerCase() === 'incoming purchases'; });
    for (var i = 0; i < headings.length; i++) {
      var node = headings[i];
      for (var depth = 0; node && depth < 8; depth++, node = node.parentElement) {
        var text = String(node.innerText || '');
        if (/PO\s*Number/i.test(text) && /Receivable/i.test(text)) return node;
      }
    }
    return null;
  }

  function receivableValue(value) {
    var text = String(value || '').trim();
    var qty = Number((text.match(/[\d,]+/) || ['0'])[0].replace(/,/g, ''));
    return /\b(?:yes|true|open|receivable)\b/i.test(text) || (isFinite(qty) && qty > 0);
  }

  function readPurchaseOrders() {
    var root = incomingPurchasesRoot();
    if (!root) return [];
    var table = root.querySelector ? root.querySelector('table') : null;
    var choices = [];
    if (table) {
      var headerCells = [].slice.call(table.querySelectorAll('thead th'));
      if (!headerCells.length) headerCells = [].slice.call(table.querySelectorAll('tr:first-child th'));
      var headers = headerCells.map(function (th) { return normalizedLabel(th.innerText); });
      var poIndex = headers.findIndex(function (l) { return l.indexOf('ponumber') >= 0; });
      var recvIndex = headers.findIndex(function (l) { return l === 'receivable' || l.indexOf('receivable') >= 0; });
      if (poIndex >= 0) {
        [].slice.call(table.querySelectorAll('tbody tr')).forEach(function (row) {
          var cells = [].slice.call(row.querySelectorAll(':scope > th,:scope > td'));
          if (cells.length <= poIndex) return;
          var po = String(cells[poIndex].innerText || '').trim();
          if (!po || /nothing here/i.test(po)) return;
          var recvText = recvIndex >= 0 ? String((cells[recvIndex] || {}).innerText || '').trim() : '';
          if (recvIndex >= 0 && !receivableValue(recvText)) return;
          var target = cells[poIndex].querySelector('a[href],button,[role="link"],[role="button"]') ||
            row.querySelector('a[href],button,[role="link"],[role="button"]') || row;
          choices.push({ po: po, receivable: recvText || 'YES', target: target });
        });
      }
    }
    if (!choices.length) {
      // Fallback: Cloudscape grid without a semantic table.
      [].slice.call(root.querySelectorAll('a[href],button,[role="link"],[role="button"]')).forEach(function (target) {
        var po = String(target.innerText || target.textContent || '').trim();
        if (!/^(?=.*[A-Z])(?=.*\d)[A-Z0-9-]{6,}$/i.test(po)) return;
        var row = target.closest('tr,[role="row"]') || target.parentElement;
        var rowText = String((row && row.innerText) || target.innerText || '').trim();
        var recvText = (rowText.match(/\b(?:YES|TRUE|OPEN|RECEIVABLE)\b/i) || [''])[0];
        choices.push({ po: po, receivable: recvText || 'YES', target: target });
      });
    }
    // De-dupe by PO number.
    return choices.filter(function (c, i, arr) { return arr.findIndex(function (o) { return o.po === c.po; }) === i; });
  }

  // ---- PIMS field driving (condensed from sendLastScanToPage) ---------------
  function isVisible(el) {
    if (!el) return false;
    var s = window.getComputedStyle(el), r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  }

  // Type a value into the PIMS Inventory search box and submit, so the
  // "Incoming Purchases" PO table populates for the scanned NDC.
  function setPimsSearch(value) {
    var inputs = [].slice.call(document.querySelectorAll('input,textarea')).filter(function (el) {
      // Never target our own overlay's capture/inputs.
      if (el.closest && el.closest('#ptx7-rx-root')) return false;
      return isVisible(el);
    });
    var input = inputs.find(function (el) {
      var p = (el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').toLowerCase();
      return /scan a package|enter an ndc|dispensable product|medication name|search/.test(p);
    }) || inputs.find(function (el) { return !el.disabled && !el.readOnly; });
    if (!input) return false;
    var proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // Prefer clicking the real Submit button (Cloudscape forms often ignore a
    // bare Enter key); fall back to dispatching Enter on the input.
    var submitBtn = [].slice.call(document.querySelectorAll('button,input[type=submit],[role="button"]'))
      .filter(function (b) { return !(b.closest && b.closest('#ptx7-rx-root')) && isVisible(b); })
      .find(function (b) {
        var t = String(b.innerText || b.value || b.getAttribute('aria-label') || '').trim().toLowerCase();
        return t === 'submit' || t === 'search';
      });
    if (submitBtn) {
      submitBtn.click();
    } else {
      ['keydown', 'keyup'].forEach(function (type) {
        input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      });
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // State machine
  // ---------------------------------------------------------------------------
  // State for the persistent receive-mirror surface. Receiving itself is done
  // by PIMS underneath; this overlay forwards scans to PIMS and mirrors PIMS's
  // state in a big, simple UI. The operator stays here until Return to PIMS.
  var state = {
    phase: 'NDC',       // 'NDC' (scan to look up) | 'PO' (select) | 'RECEIVE'
    ndc: '',            // NDC searched
    drug: '',           // drug name from PIMS result
    pos: [],            // PO choices for the scanned NDC
    poPollTimer: null,
    poPollTries: 0,
    releaseFocus: false,   // diagnostic: when true, don't steal focus/deliver
    buffer: '',
    lastKeyAt: 0,
    timer: null,
    captureTimer: null,
    mirrorTimer: null,
    lastSignature: ''
  };

  // ---------------------------------------------------------------------------
  // Overlay DOM
  // ---------------------------------------------------------------------------
  var root = document.createElement('div');
  root.id = 'ptx7-rx-root';
  root.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647', 'display:none',
    'font-family:Arial,Helvetica,sans-serif', 'background:#ffffff', 'color:#172b3a',
    'overflow:auto', '-webkit-text-size-adjust:100%'
  ].join(';');

  var STYLE = document.createElement('style');
  STYLE.textContent =
    '#ptx7-rx-root *{box-sizing:border-box}' +
    '#ptx7-rx-root{font-size:20px}' +
    '#ptx7-rx-bar{display:flex;align-items:center;min-height:64px;background:#007A83;color:#fff;padding:10px 14px}' +
    '#ptx7-rx-bar .back{background:rgba(255,255,255,.18);border:0;color:#fff;font-size:18px;font-weight:900;padding:14px 16px;border-radius:12px}' +
    '#ptx7-rx-bar .title{flex:1;text-align:center;font-size:30px;font-weight:900;letter-spacing:1px}' +
    '#ptx7-rx-bar .spacer{width:70px}' +
    '#ptx7-rx-dots{display:none}' +
    '#ptx7-rx-body{padding:16px 20px 28px;max-width:none;margin:0}' +
    '.ptx7-rx-step{text-align:center;color:#59636b;font-weight:900;font-size:20px;letter-spacing:1px;margin:10px 0 6px}' +
    '.ptx7-rx-head{text-align:center;color:#172b3a;font-weight:900;font-size:34px;line-height:1.15;margin:8px 0}' +
    '.ptx7-rx-sub{text-align:center;color:#59636b;font-size:20px;margin:6px 0 16px}' +
    '.ptx7-rx-scanbox{border:6px solid #007A83;border-radius:22px;padding:34px 14px;text-align:center;margin:20px 0}' +
    '.ptx7-rx-scanbox .glyph{font-size:60px;letter-spacing:8px}' +
    '.ptx7-rx-scanbox .label{color:#007A83;font-weight:900;font-size:32px;margin-top:14px}' +
    // Giant primary buttons: tall, chunky, easy to hit.
    '.ptx7-rx-btn{display:block;width:100%;border:0;border-radius:20px;padding:28px 18px;margin:18px 0;font-weight:900;font-size:30px;cursor:pointer;line-height:1.1}' +
    '.ptx7-rx-btn.primary{background:#007A83;color:#fff;box-shadow:0 6px 0 #005a61}' +
    '.ptx7-rx-btn.ghost{background:#fff;color:#005A61;border:4px solid #cdd5db}' +
    '.ptx7-rx-btn.wait{background:#eceff2;color:#59636b;font-size:24px}' +
    '.ptx7-rx-btn .meta{display:block;font-size:18px;font-weight:800;margin-top:8px;opacity:.9}' +
    '.ptx7-rx-po{background:#fff;color:#007A83;border:6px solid #007A83;box-shadow:0 5px 14px #0002}' +
    '.ptx7-rx-confirm{border-radius:18px;padding:22px 16px;margin:18px 0;text-align:center;font-weight:900;font-size:26px}' +
    '.ptx7-rx-confirm.ok{background:#e6f6eb;border:3px solid #087f3f;color:#087f3f}' +
    '.ptx7-rx-confirm.bad{background:#fff1f0;border:3px solid #b42318;color:#b42318}' +
    '.ptx7-rx-confirm .meta{display:block;color:#172b3a;font-weight:700;font-size:18px;margin-top:8px}' +
    '.ptx7-rx-success{background:#087f3f;color:#fff;border-radius:22px;padding:34px 16px;text-align:center;margin:20px 0}' +
    '.ptx7-rx-success .big{font-size:44px;font-weight:900}' +
    '.ptx7-rx-success .loc{font-size:40px;font-weight:900;margin-top:14px;letter-spacing:1px}' +
    '.ptx7-rx-success .drug{font-size:22px;margin-top:12px}' +
    '#ptx7-rx-foot{position:sticky;bottom:0;background:#f6f8f9;text-align:center;color:#59636b;font-size:15px;padding:12px 14px}';
  // Visual-only handheld sizing overrides. Existing render/state/scanner
  // functions remain unchanged from confirmed working build #49.
  STYLE.textContent +=
    '#ptx7-rx-root{inset:0 auto auto 0!important;width:50%!important;height:50%!important;transform:scale(2);transform-origin:top left;overflow-y:auto;overflow-x:hidden;background:#fff}' +
    '#ptx7-rx-bar{min-height:112px;padding:16px 22px;position:sticky;top:0;z-index:4;border-bottom:6px solid #005a61}' +
    '#ptx7-rx-bar .title{font-size:54px}' +
    '#ptx7-rx-bar .back,#ptx7-rx-bar .gear{width:96px;height:84px;font-size:38px;padding:8px}' +
    '#ptx7-rx-body{padding:32px 28px 190px;max-width:100%;min-height:calc(100vh - 150px)}' +
    '.ptx7-rx-step{font-size:38px;margin:18px 0 12px}' +
    '.ptx7-rx-head{font-size:64px;line-height:1.12;margin:22px 0}' +
    '.ptx7-rx-sub{font-size:36px;line-height:1.4;margin:16px 0 26px}' +
    '.ptx7-rx-scanbox{min-height:330px;display:flex;flex-direction:column;justify-content:center;padding:46px 26px;border-width:9px}' +
    '.ptx7-rx-scanbox .glyph{font-size:112px}.ptx7-rx-scanbox .label{font-size:60px}' +
    '.ptx7-rx-btn{min-height:132px;font-size:48px;margin:24px 0;border-radius:24px}' +
    '.ptx7-rx-btn .meta{font-size:34px;margin-top:14px}' +
    '.ptx7-rx-success{padding:42px 28px;border-radius:26px}' +
    '.ptx7-rx-success .big{font-size:64px}.ptx7-rx-success .loc{font-size:94px;line-height:1.08}' +
    '.ptx7-rx-success .drug{font-size:42px;line-height:1.25}' +
    '.ptx7-rx-confirm{font-size:46px;padding:38px 26px}.ptx7-rx-confirm .meta{font-size:34px}' +
    '#ptx7-rx-submit-fixed{position:fixed;right:24px;bottom:108px;z-index:8;min-width:42%;min-height:112px;border:0;border-radius:18px;background:#007a83;color:#fff;font:900 38px Arial;box-shadow:0 6px 18px #0005;padding:16px 22px}' +
    '#ptx7-rx-new-po{position:fixed;left:24px;bottom:108px;z-index:8;display:none;min-width:42%;min-height:112px;border:5px solid #007a83;border-radius:18px;background:#fff;color:#007a83;font:900 36px Arial;box-shadow:0 6px 18px #0003;padding:16px 22px}' +
    '#ptx7-rx-submit-fixed:disabled{background:#98a2b3;color:#e9edf1;box-shadow:none}' +
    '#ptx7-rx-foot{font-size:26px;min-height:58px;padding:16px}' +
    '.ptx7-count{margin:18px 0;padding:22px;border-radius:22px;border:6px solid #007a83;background:#eef7f8;text-align:center}' +
    '.ptx7-count .num{font:900 96px Arial;line-height:1;color:#005a61}' +
    '.ptx7-count .lbl{font:900 34px Arial;margin-top:8px;color:#172b3a}' +
    '.ptx7-count .bar{height:38px;border-radius:19px;background:#d5e3e6;margin-top:18px;overflow:hidden}' +
    '.ptx7-count .fill{height:100%;background:#007a83;transition:width .25s}' +
    '.ptx7-count.done{border-color:#087f3f;background:#e6f6eb}.ptx7-count.done .num{color:#087f3f}.ptx7-count.done .fill{background:#087f3f}' +
    '.ptx7-count.over{border-color:#b42318;background:#fff1f0}.ptx7-count.over .num{color:#b42318}.ptx7-count.over .fill{background:#b42318}' +
    '.ptx7-count.bump{animation:ptx7bump .45s ease-out}' +
    '@keyframes ptx7bump{0%{transform:scale(1.08);box-shadow:0 0 0 14px #007a8355}100%{transform:scale(1);box-shadow:none}}' +
    '@media(max-width:900px){#ptx7-rx-bar .title{font-size:46px}.ptx7-rx-head{font-size:56px}.ptx7-rx-success .loc{font-size:80px}.ptx7-rx-btn{font-size:42px}}';
  // Speed Receive (beta21) styles: toggle pill + quadrant QR cards.
  STYLE.textContent +=
    '.ptx7-sr-row{display:flex;align-items:center;justify-content:space-between;gap:16px;background:#eef7f8;border:5px solid #007a83;border-radius:20px;padding:20px 22px;margin:16px 0 22px}' +
    '.ptx7-sr-row .lbl{font-weight:900;font-size:34px;color:#005a61}' +
    '.ptx7-sr-pill{border:0;border-radius:999px;padding:16px 34px;font-weight:900;font-size:32px;color:#fff;background:#087f3f}' +
    '.ptx7-sr-pill.off{background:#98a2b3}' +
    '.ptx7-qcard{border-radius:26px;padding:26px 20px 28px;margin:20px 0;text-align:center;color:#fff;box-shadow:0 8px 22px #0003}' +
    '.ptx7-qcard .qtag{display:inline-block;background:#fff;color:#172b3a;font-weight:900;font-size:34px;padding:8px 28px;border-radius:999px;letter-spacing:2px}' +
    '.ptx7-qcard .loc{font-size:52px;font-weight:900;margin:16px 0 10px;letter-spacing:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.ptx7-qcard .qrwrap{background:#fff;display:inline-block;padding:18px;border-radius:20px;margin-top:6px}' +
    '.ptx7-qcard .qrwrap canvas{display:block;width:420px;height:420px;image-rendering:pixelated}' +
    '.ptx7-qcard .hint{font-size:28px;font-weight:800;margin-top:16px;opacity:.95}';
  root.appendChild(STYLE);

  var bar = document.createElement('div');
  bar.id = 'ptx7-rx-bar';
  bar.innerHTML = '<button class="back" type="button" id="ptx7-rx-back">\u2039 PIMS</button>' +
    '<div class="title">RECEIVING</div>' +
    '<button class="back gear" type="button" id="ptx7-rx-gear" aria-label="Tools and settings">\u2699</button>';
  root.appendChild(bar);

  var dots = document.createElement('div');
  dots.id = 'ptx7-rx-dots';
  dots.innerHTML = [1, 2, 3, 4].map(function (n) { return '<div class="ptx7-rx-dot" data-n="' + n + '">' + n + '</div>'; }).join('');
  root.appendChild(dots);

  var body = document.createElement('div');
  body.id = 'ptx7-rx-body';
  root.appendChild(body);

  var foot = document.createElement('div');
  foot.id = 'ptx7-rx-foot';
  foot.textContent = 'Built-in scanner active \u00b7 camera off';
  root.appendChild(foot);

  // Hidden-but-focused capture input. The PM86 wedge commits scanned text into
  // whatever editable field is focused (this is how it filled Notes). The
  // Receiving screen has no visible input, so we keep this one focused to catch
  // the scan. Positioned off to a 1px corner and transparent, but NOT
  // display:none (which would make it unfocusable).
  var capture = document.createElement('input');
  capture.id = 'ptx7-rx-capture';
  capture.type = 'text';
  capture.setAttribute('autocomplete', 'off');
  capture.setAttribute('autocorrect', 'off');
  capture.setAttribute('autocapitalize', 'off');
  capture.setAttribute('spellcheck', 'false');
  capture.setAttribute('inputmode', 'none'); // discourage the soft keyboard
  capture.style.cssText = [
    'position:absolute', 'left:0', 'top:0', 'width:1px', 'height:1px',
    'opacity:0.01', 'border:0', 'padding:0', 'margin:0', 'background:transparent',
    'color:transparent', 'caret-color:transparent', 'z-index:1'
  ].join(';');
  root.appendChild(capture);

  (document.body || document.documentElement).appendChild(root);

  var submitReceivesButton = document.createElement('button');
  submitReceivesButton.id = 'ptx7-rx-submit-fixed';
  submitReceivesButton.type = 'button';
  submitReceivesButton.textContent = 'SUBMIT RECEIVES';
  submitReceivesButton.style.display = 'none';
  root.appendChild(submitReceivesButton);

  var newPoButton = document.createElement('button');
  newPoButton.id = 'ptx7-rx-new-po';
  newPoButton.type = 'button';
  newPoButton.textContent = 'SEARCH NEW PO';
  root.appendChild(newPoButton);
  newPoButton.addEventListener('click', function () {
    var unfinished = !!currentReceiveDetail() || !!queuedReceiveSignature() || submitReceivesBusy;
    if (unfinished && !confirm('Current item is unfinished—leave anyway?\n\nUnsaved receiving data will be lost.')) return;
    try { sessionStorage.removeItem('ptx7_rx_resume'); } catch (_) {}
    try {
      if (window.PTX7Host && window.PTX7Host.startNewPoSearch) {
        window.PTX7Host.startNewPoSearch();
        return;
      }
    } catch (_) {}
    root.style.display = 'none';
    location.href = INVENTORY_URL;
  });

  var submitReceivesBusy = false;
  var lastAutoSubmittedQueue = '';
  function queuedReceiveSignature() {
    var tables = [].slice.call(document.querySelectorAll('table'));
    for (var ti=0; ti<tables.length; ti++) {
      var table=tables[ti];
      if (table.closest && table.closest('#ptx7-rx-root')) continue;
      if (!/Currently Scanned/i.test(table.innerText || '')) continue;
      var headers=[].slice.call(table.querySelectorAll('thead th')).map(function(h){return String(h.innerText||'').replace(/[^a-z0-9]/gi,'').toLowerCase();});
      var index=headers.findIndex(function(h){return h==='currentlyscanned';});
      if(index<0) continue;
      var rows=[].slice.call(table.querySelectorAll('tbody tr'));
      for(var ri=0;ri<rows.length;ri++){
        var cells=[].slice.call(rows[ri].querySelectorAll(':scope > td,:scope > th'));
        var value=String((cells[index]&&cells[index].innerText)||'').trim();
        var quantity=Number(((value.match(/[\d.]+/)||['0'])[0]));
        if(quantity>0) return String(rows[ri].innerText||'').replace(/\s+/g,' ').trim();
      }
    }
    return '';
  }
  function clickSubmitReceivesOnce(reason) {
    if (submitReceivesBusy) return false;
    var pimsButton = document.querySelector('button[data-testid="submit-receives"]');
    if (!pimsButton || pimsButton.disabled || pimsButton.getAttribute('aria-disabled') === 'true') {
      setDebug('PIMS Submit Receives is unavailable — return to PIMS');
      return false;
    }
    submitReceivesBusy = true;
    submitReceivesButton.disabled = true;
    submitReceivesButton.textContent = 'SUBMITTING…';
    setDebug('Submit Receives activated once (' + reason + '); waiting for PIMS');
    pimsButton.click();
    // A click is never confirmation. PIMS dialog/quantities remain authoritative.
    setTimeout(function(){ submitReceivesBusy = false; }, 1800);
    return true;
  }
  submitReceivesButton.addEventListener('click', function() { clickSubmitReceivesOnce('manual fallback'); });
  setInterval(function() {
    var receiving = root.style.display === 'block' && state.phase === 'RECEIVE';
    newPoButton.style.display = receiving && onReceivingPage() ? 'block' : 'none';
    var detail = receiving ? currentReceiveDetail() : null;
    var pimsButton = receiving ? document.querySelector('button[data-testid="submit-receives"]') : null;
    submitReceivesButton.style.display = receiving ? 'block' : 'none';
    if (!receiving) { lastAutoSubmittedQueue=''; return; }
    if (detail) {
      submitReceivesBusy = false;
      submitReceivesButton.disabled = true;
      submitReceivesButton.textContent = 'SCAN LOCATION TO COMPLETE';
      return;
    }
    var queue = queuedReceiveSignature();
    if (!queue) lastAutoSubmittedQueue = '';
    var available = !!pimsButton && !pimsButton.disabled && pimsButton.getAttribute('aria-disabled') !== 'true';
    if (queue && queue !== lastAutoSubmittedQueue && available && !submitReceivesBusy) {
      lastAutoSubmittedQueue = queue;
      clickSubmitReceivesOnce('PIMS Currently Scanned row');
      return;
    }
    submitReceivesButton.disabled = submitReceivesBusy || !available;
    submitReceivesButton.textContent = submitReceivesBusy ? 'SUBMITTING…' : 'SUBMIT RECEIVES';
  }, 350);

  // ---------------------------------------------------------------------------
  // Audio feedback (Web Audio, no assets)
  // ---------------------------------------------------------------------------
  var audioCtx = null;
  var SOUND_STYLE_KEY = 'ptx7_rx_sound_style_v2';
  var SOUND_VOLUME_KEY = 'ptx7_rx_sound_volume';
  function soundStyle(){ try{return localStorage.getItem(SOUND_STYLE_KEY)||'muted';}catch(e){return 'muted';} }
  function soundVolume(){ var value='low';try{value=localStorage.getItem(SOUND_VOLUME_KEY)||'low';}catch(e){}return {low:0.006,medium:0.014,high:0.03}[value]||0.006; }
  function tone(ok) {
    try {
      var style=soundStyle();if(style==='muted')return;
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var gentle=style==='gentle';
      var seq=gentle?(ok?[[520,0,0.09]]:[[260,0,0.14]]):(ok?[[780,0,0.07],[980,0.09,0.12]]:[[300,0,0.16],[220,0.18,0.24]]);
      var peak=soundVolume(),t0=audioCtx.currentTime+0.02;
      seq.forEach(function(n){
        var osc=audioCtx.createOscillator(),g=audioCtx.createGain();
        osc.type=gentle?'sine':(ok?'square':'sawtooth');
        osc.frequency.setValueAtTime(n[0],t0+n[1]);
        g.gain.setValueAtTime(0.0001,t0+n[1]);
        g.gain.exponentialRampToValueAtTime(peak,t0+n[1]+0.04);
        g.gain.exponentialRampToValueAtTime(0.0001,t0+n[1]+n[2]);
        osc.connect(g);g.connect(audioCtx.destination);osc.start(t0+n[1]);osc.stop(t0+n[1]+n[2]+0.03);
      });
    } catch (e) {}
  }


  // Voice and settings are visual/accessibility helpers only. They do not
  // participate in scanner capture or PIMS delivery.
  var VOICE_ON_KEY = 'ptx7_rx_voice_on';
  var VOICE_NAME_KEY = 'ptx7_rx_voice_name';
  var VOICE_RATE_KEY = 'ptx7_rx_voice_rate';
  var ORIENTATION_KEY = 'ptx7_rx_orientation';
  function voiceEnabled(){ try{return localStorage.getItem(VOICE_ON_KEY)!=='false';}catch(e){return true;} }
  function voiceRate(){ var value=1;try{value=Number(localStorage.getItem(VOICE_RATE_KEY)||1);}catch(e){}return [0.85,1,1.15,1.3].indexOf(value)>=0?value:1; }
  function voices(){ return window.speechSynthesis ? window.speechSynthesis.getVoices().filter(function(v){return /^en[-_]/i.test(v.lang||'');}) : []; }
  function selectedVoice(){ var all=voices(),saved='';try{saved=localStorage.getItem(VOICE_NAME_KEY)||'';}catch(e){}return all.find(function(v){return v.voiceURI===saved||v.name===saved;})||all[0]||null; }
  function spokenLocation(location){
    var value=String(location||'').toUpperCase();
    var match=value.match(/^(?:MAN(?:FW|WS)?|CLD[A-Z]*)0*(\d{3})-([A-Z])-(\d{1,2})$/);
    if(!match)return value.replace(/-/g,', ');
    return match[1].split('').join(' ')+', '+match[2]+', '+Number(match[3]);
  }
  function speakLocations(locations,force){
    try{
      if(!force&&!voiceEnabled())return;
      var nativeList=(locations||[]).filter(Boolean);
      try{if(nativeList.length&&window.PTX7Host&&window.PTX7Host.speak&&(!window.PTX7Host.ttsAvailable||window.PTX7Host.ttsAvailable())){
        var nativeText=nativeList.length===1?spokenLocation(nativeList[0]):nativeList.map(function(l,i){return 'Location '+(i+1)+'. '+spokenLocation(l)+'.';}).join(' ');
        var nativeVoice='';try{nativeVoice=localStorage.getItem('ptx7_buddy_voice')||'';}catch(_){}
        window.PTX7Host.speak(nativeText,voiceRate(),nativeVoice);return;}}catch(_){}
      if(!window.speechSynthesis)return;
      var list=(locations||[]).filter(Boolean);if(!list.length)return;
      window.speechSynthesis.cancel();
      var text=list.length===1?spokenLocation(list[0]):list.map(function(l,i){return 'Location '+(i+1)+'. '+spokenLocation(l)+'.';}).join(' ');
      var utterance=new SpeechSynthesisUtterance(text);utterance.rate=voiceRate();var voice=selectedVoice();if(voice)utterance.voice=voice;
      window.speechSynthesis.speak(utterance);
    }catch(e){}
  }
  var lastSpokenLocations='';
  var lastCountKey='', countBumpAt=0;
  // Count of this item scanned so far (confirmed + pending) against PO ordered.
  function itemCount(detail){
    if(!detail||!detail.ordered||!detail.ordered.pkgs)return null;
    var done=detail.received?detail.received.pkgs:(detail.scanned?detail.scanned.pkgs:0);
    return {done:done,total:detail.ordered.pkgs};
  }
  function itemCountHtml(detail){
    var c=itemCount(detail);if(!c)return '';
    var cls='ptx7-count'+(c.done>c.total?' over':(c.done===c.total?' done':''))+(Date.now()-countBumpAt<600?' bump':'');
    var label=c.done>c.total?('OVER BY '+(c.done-c.total)+' \u2014 CHECK PIMS'):(c.done===c.total?'ALL '+c.total+' SCANNED \u2714':(c.total-c.done)+' REMAINING');
    var pct=Math.min(100,Math.round(c.done/c.total*100));
    return '<div class="'+cls+'"><div class="num">'+esc(c.done)+' / '+esc(c.total)+'</div>'+
      '<div class="lbl">'+esc(label)+'</div><div class="bar"><div class="fill" style="width:'+pct+'%"></div></div></div>';
  }
  setInterval(function(){
    if(root.style.display!=='block'||state.phase!=='RECEIVE')return;
    var detail=currentReceiveDetail();var key=detail&&detail.locations?detail.ndc+'|'+detail.locations.join('|'):'';
    if(key&&key!==lastSpokenLocations){lastSpokenLocations=key;speakLocations(detail.locations,false);}
    if(!detail)lastSpokenLocations='';
    // Like-item count-up: the protected mirror re-renders only on NDC changes,
    // so refresh here whenever the same item's scanned count changes.
    var count=itemCount(detail),countKey=detail&&count?detail.ndc+'#'+count.done:'';
    if(countKey!==lastCountKey){
      var sameItem=lastCountKey&&countKey&&lastCountKey.split('#')[0]===countKey.split('#')[0];
      var increased=sameItem&&Number(countKey.split('#')[1])>Number(lastCountKey.split('#')[1]);
      lastCountKey=countKey;
      if(increased){countBumpAt=Date.now();tone(true);}
      if(sameItem)render();
    }
  },500);

  var settings=document.createElement('section');
  settings.id='ptx7-rx-settings';
  settings.style.cssText='position:fixed;inset:112px 0 84px;z-index:20;display:none;background:#fff;padding:34px;overflow:auto;font:900 34px Arial;color:#172b3a';
  settings.innerHTML='<h2 style="font-size:56px;margin:0 0 26px;border-bottom:5px solid #007a83;padding-bottom:14px">TOOLS / SETTINGS</h2>'+
    '<label style="display:block;margin:22px 0">SCAN TONES <select id="ptx7-sound-style" style="width:100%;height:88px;font-size:32px"><option value="muted">OFF (DEFAULT)</option><option value="gentle">GENTLE CHIME</option><option value="standard">STANDARD BEEP</option></select></label>'+
    '<label style="display:block;margin:22px 0">TONE VOLUME <select id="ptx7-sound-volume" style="width:100%;height:88px;font-size:32px"><option value="low">LOW (DEFAULT)</option><option value="medium">MEDIUM</option><option value="high">HIGH</option></select></label>'+
    '<button id="ptx7-tone-preview" class="ptx7-rx-btn ghost">♪ PREVIEW TONE</button>'+
    '<label style="display:block;margin:22px 0">LOCATION VOICE <select id="ptx7-voice-on" style="width:100%;height:88px;font-size:32px"><option value="on">ON</option><option value="off">MUTED</option></select></label>'+
    '<label style="display:block;margin:22px 0">VOICE <select id="ptx7-voice-name" style="width:100%;height:88px;font-size:32px"></select></label>'+
    '<label style="display:block;margin:22px 0">SPEED <select id="ptx7-voice-rate" style="width:100%;height:88px;font-size:32px"><option value="0.85">0.85×</option><option value="1">1.00×</option><option value="1.15">1.15×</option><option value="1.3">1.30×</option></select></label>'+
    '<label style="display:block;margin:22px 0">ORIENTATION <select id="ptx7-orientation" style="width:100%;height:88px;font-size:32px"><option value="AUTO">AUTO ROTATE</option><option value="PORTRAIT">LOCK PORTRAIT</option><option value="LANDSCAPE">LOCK LANDSCAPE</option></select></label>'+
    '<button id="ptx7-voice-preview" class="ptx7-rx-btn primary">🔊 PREVIEW LOCATION</button>'+
    '<button id="ptx7-show-diag" class="ptx7-rx-btn ghost">SHOW DIAGNOSTIC</button>'+
    '<textarea id="ptx7-settings-diag" readonly style="display:none;width:100%;height:320px;font:22px monospace"></textarea>'+
    '<button id="ptx7-settings-done" class="ptx7-rx-btn primary">DONE</button>';
  root.appendChild(settings);
  function populateVoiceSettings(){
    var select=settings.querySelector('#ptx7-voice-name'),saved='';try{saved=localStorage.getItem(VOICE_NAME_KEY)||'';}catch(e){}
    select.replaceChildren(new Option('Automatic device voice',''));
    voices().forEach(function(v){select.add(new Option(v.name+' ('+v.lang+')',v.voiceURI||v.name));});select.value=saved;
  }
  function openSettings(){
    state.releaseFocus=true;
    try{capture.blur();}catch(e){}
    try{if(window.PTX7Host&&window.PTX7Host.setScanOwnership)window.PTX7Host.setScanOwnership(false);}catch(e){}
    settings.querySelector('#ptx7-sound-style').value=soundStyle();
    var savedVolume='low';try{savedVolume=localStorage.getItem(SOUND_VOLUME_KEY)||'low';}catch(_){}
    settings.querySelector('#ptx7-sound-volume').value=savedVolume;
    settings.querySelector('#ptx7-voice-on').value=voiceEnabled()?'on':'off';
    settings.querySelector('#ptx7-voice-rate').value=String(voiceRate());
    settings.querySelector('#ptx7-orientation').value=localStorage.getItem(ORIENTATION_KEY)||'AUTO';
    populateVoiceSettings();settings.style.display='block';
  }
  settings.querySelector('#ptx7-sound-style').onchange=function(e){localStorage.setItem(SOUND_STYLE_KEY,e.target.value);};
  settings.querySelector('#ptx7-sound-volume').onchange=function(e){localStorage.setItem(SOUND_VOLUME_KEY,e.target.value);};
  settings.querySelector('#ptx7-tone-preview').onclick=function(){tone(true);};
  settings.querySelector('#ptx7-voice-on').onchange=function(e){localStorage.setItem(VOICE_ON_KEY,e.target.value==='on'?'true':'false');if(e.target.value==='off'&&window.speechSynthesis)window.speechSynthesis.cancel();};
  settings.querySelector('#ptx7-voice-name').onchange=function(e){localStorage.setItem(VOICE_NAME_KEY,e.target.value);};
  settings.querySelector('#ptx7-voice-rate').onchange=function(e){localStorage.setItem(VOICE_RATE_KEY,e.target.value);};
  settings.querySelector('#ptx7-orientation').onchange=function(e){localStorage.setItem(ORIENTATION_KEY,e.target.value);try{if(window.PTX7Host&&window.PTX7Host.setOrientationMode)window.PTX7Host.setOrientationMode(e.target.value);}catch(_){};};
  settings.querySelector('#ptx7-voice-preview').onclick=function(){var d=currentReceiveDetail();speakLocations(d&&d.locations&&d.locations.length?d.locations:['MANFW0105-C-10'],true);};
  settings.querySelector('#ptx7-show-diag').onclick=function(){var box=settings.querySelector('#ptx7-settings-diag');box.value=buildDiagnostic();box.style.display='block';};
  settings.querySelector('#ptx7-settings-done').onclick=function(){settings.style.display='none';state.releaseFocus=false;render();setTimeout(focusCapture,20);};
  document.getElementById('ptx7-rx-gear').onclick=openSettings;
  if(window.speechSynthesis&&window.speechSynthesis.addEventListener)window.speechSynthesis.addEventListener('voiceschanged',function(){if(settings.style.display==='block')populateVoiceSettings();});

  // Hide the step-dots row; this flow is a continuous scan loop, not 4 steps.
  dots.style.display = 'none';

  function setDebug(text) { foot.textContent = text; }

  function scanBox(label) {
    return '<div class="ptx7-rx-scanbox"><div class="glyph">|||\u2009||\u2009|\u2009|||</div>' +
      '<div class="label">' + esc(label) + '</div></div>';
  }

  // ---------------------------------------------------------------------------
  // Mirror the live PIMS receiving page in a big, simple UI.
  //
  // The operator stays here and just scans. PIMS underneath does the real
  // receiving; we forward each scan to PIMS and reflect its state:
  //   - No drug pending  -> big "SCAN MEDICATION"
  //   - Drug pending     -> big "SCAN LOCATION" + suggested location + drug
  //   - After submit     -> brief success, then back to "SCAN MEDICATION"
  // ---------------------------------------------------------------------------
  function render() {
    var h = '';

    if (state.phase === 'NDC') {
      // Phase 1: scan an NDC to look up its purchase orders.
      h += '<div class="ptx7-rx-step">STEP 1 \u00b7 FIND PO</div>';
      h += '<div class="ptx7-rx-head">Scan a medication NDC</div>';
      h += scanBox('SCAN NDC');
      h += '<div class="ptx7-rx-sub">Scan an NDC to look up its purchase orders.</div>';

    } else if (state.phase === 'PO') {
      // Phase 2: pick the correct PO from the lookup.
      h += '<div class="ptx7-rx-step">STEP 2 \u00b7 SELECT PO</div>';
      h += '<div class="ptx7-rx-head">' + esc(state.drug || ('NDC ' + state.ndc)) + '</div>';
      h += '<div class="ptx7-rx-sub">Tap the correct purchase order.</div>';
      if (!state.pos.length) {
        h += '<div class="ptx7-rx-confirm bad">Looking up purchase orders\u2026' +
          '<span class="meta">If none appear, scan the NDC again.</span></div>';
      } else {
        state.pos.forEach(function (p, i) {
          h += '<button class="ptx7-rx-btn ptx7-rx-po" type="button" data-po="' + i + '">' +
            esc(p.po) + '<span class="meta">Receivable: ' + esc(p.receivable) + '</span></button>';
        });
      }
      h += '<button class="ptx7-rx-btn wait" type="button" id="ptx7-rx-rescan">SCAN A DIFFERENT NDC</button>';

    } else {
      // Phase 3: receive loop inside the PO. Mirror the live PIMS state.
      var po = currentPo();
      var prog = currentProgress();
      var detail = currentReceiveDetail();
      h += '<div class="ptx7-rx-step">' + (po ? 'PO ' + esc(po) : 'RECEIVING') + '</div>';

      if (detail) {
        // Active PIMS dialog is authoritative. Bind identity, quantities, and
        // all locations from the same current product snapshot.
        var ordered = detail.ordered, received = detail.received, scanned = detail.scanned;
        var pendingPkgs = scanned ? scanned.pkgs : 0;
        var pendingUnits = scanned ? scanned.units : 0;
        var confirmedPkgs = received ? Math.max(0, received.pkgs - pendingPkgs) : 0;
        var confirmedUnits = received ? Math.max(0, received.units - pendingUnits) : 0;
        h += '<div class="ptx7-rx-head">Scan location to complete receive</div>';
        h += '<div class="ptx7-rx-confirm ok"><strong>' + esc(detail.drug || ('NDC ' + detail.ndc)) + '</strong>' +
          '<span class="meta">NDC ' + esc(detail.ndc) + (detail.pkgSize ? ' · Package size ' + esc(detail.pkgSize) + ' ' + esc(detail.unitWord) : '') + '</span>';
        if (ordered && (scanned || received)) {
          h += '<span class="meta">' + esc(confirmedPkgs) + ' confirmed · ' + esc(pendingPkgs) + ' pending (' + esc(confirmedUnits) + ' confirmed · ' + esc(pendingUnits) + ' pending)</span>';
        } else if (scanned) {
          h += '<div style="font-size:38px;margin-top:12px">' + esc(scanned.pkgs) + ' bottle' + (scanned.pkgs === 1 ? '' : 's') + ' scanned</div>' +
            '<span class="meta">Expected quantity unavailable</span>';
        } else {
          h += '<span class="meta">Pending quantity loading from PIMS</span>';
        }
        h += '</div>';
        h += itemCountHtml(detail);
        if (detail.warnings && detail.warnings.length) h += '<div class="ptx7-rx-confirm bad">⚠ ' + esc(detail.warnings.join(' · ')) + '</div>';
        // Speed Receive toggle (always visible in RECEIVE so it can be flipped).
        var srOn = speedReceiveOn();
        h += '<div class="ptx7-sr-row"><span class="lbl">\u26A1 SPEED RECEIVE</span>' +
          '<button type="button" id="ptx7-sr-toggle" class="ptx7-sr-pill' + (srOn ? '' : ' off') + '">' +
          (srOn ? 'ON' : 'OFF') + '</button></div>';

        if (detail.locations && detail.locations.length) {
          // Multi-location reconciliation (beta21): flag NDCs with >1 suggested
          // location so techs can review/remove later under Locations.
          if (detail.locations.length > 1) {
            try {
              if (window.__ptx7FlagMultiLoc) window.__ptx7FlagMultiLoc(detail.ndc, detail.drug, detail.locations);
            } catch (e) {}
          }
          if (srOn) {
            // Quadrant-colored QR card per suggested location (bare location string).
            detail.locations.forEach(function (location, i) {
              var zone = zoneFor(location);
              var hint = zoneHint(location);
              h += '<div class="ptx7-qcard" style="background:' + zoneColor(zone) + '">' +
                '<span class="qtag">' + esc(zone) + '</span>' +
                '<div class="loc">' + esc(location) + '</div>' +
                '<div class="qrwrap"><canvas class="ptx7-qr-canvas" data-qr="' + esc(location) + '" data-qr-i="' + i + '" width="420" height="420"></canvas></div>' +
                (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') +
                '</div>';
            });
          } else {
            h += '<div class="ptx7-rx-sub" style="font-weight:900">Suggested locations</div>';
            detail.locations.forEach(function(location){
              h += '<div class="ptx7-rx-success" style="margin:12px 0"><div class="loc">' + esc(location) + '</div></div>';
            });
          }
        } else {
          h += '<div class="ptx7-rx-confirm bad">Suggested locations unavailable — View PIMS</div>';
        }
        if (!srOn) h += scanBox('SCAN LOCATION');
        h += '<div class="ptx7-rx-sub">Pending location confirmation. Receipt is not confirmed yet.</div>';
      } else {
        // Ready for the next item. Show a big "begin / progress" prompt.
        h += '<div class="ptx7-rx-head">Begin receiving inventory</div>';
        if (prog) {
          h += '<div class="ptx7-rx-confirm ok" style="font-size:40px">' +
            esc(prog.received) + ' / ' + esc(prog.total) +
            '<span class="meta">items received in this PO</span></div>';
        }
        h += scanBox('SCAN ITEM');
        h += '<div class="ptx7-rx-sub">Scan each item\u2019s 2D barcode, then its location.</div>';
        h += '<div class="ptx7-rx-sub" style="font-size:12px;color:#8a93a0">inputs: ' + esc(probePimsInputs()) + '</div>';
        h += '<button class="ptx7-rx-btn wait" type="button" id="ptx7-rx-togglefocus" style="font-size:18px">' +
          (state.releaseFocus ? 'FOCUS: RELEASED (scan \u2192 PIMS)' : 'FOCUS: CAPTURED (overlay)') + '</button>';
        h += '<button class="ptx7-rx-btn wait" type="button" id="ptx7-rx-diag" style="font-size:18px">SHOW DIAGNOSTIC</button>';
        h += '<div id="ptx7-rx-diagbox"></div>';
      }
    }

    h += '<button class="ptx7-rx-btn ghost" type="button" id="ptx7-rx-exit">\u2190 RETURN TO PIMS</button>';

    body.innerHTML = h;

    // Speed Receive: wire toggle and draw any quadrant QR canvases.
    var srToggle = document.getElementById('ptx7-sr-toggle');
    if (srToggle) srToggle.onclick = function () { setSpeedReceive(!speedReceiveOn()); render(); };
    var qrCanvases = body.querySelectorAll('canvas.ptx7-qr-canvas');
    for (var qi = 0; qi < qrCanvases.length; qi++) {
      var cv = qrCanvases[qi];
      var loc = cv.getAttribute('data-qr');
      if (!drawLocationQr(cv, loc)) {
        // Fallback: if the encoder is unavailable, show the location text clearly.
        var fb = document.createElement('div');
        fb.style.cssText = 'font:900 30px Arial;color:#172b3a;padding:30px';
        fb.textContent = loc;
        if (cv.parentNode) cv.parentNode.replaceChild(fb, cv);
      }
    }

    var exit = document.getElementById('ptx7-rx-exit');
    if (exit) exit.onclick = function () { window.__ptx7Rx.close(); };
    var rescan = document.getElementById('ptx7-rx-rescan');
    if (rescan) rescan.onclick = function () { startNdcPhase(); };
    [].slice.call(body.querySelectorAll('[data-po]')).forEach(function (btn) {
      btn.onclick = function () {
        var p = state.pos[Number(btn.getAttribute('data-po'))];
        if (p) choosePo(p);
      };
    });

    // Tell the native host whether we own the scan right now (NDC) or PIMS does
    // (PO/RECEIVE), so native key interception matches and PIMS gets the scan.
    try {
      if (window.PTX7Host && window.PTX7Host.setScanOwnership) {
        window.PTX7Host.setScanOwnership(assistantOwnsScan());
      }
    } catch (e) {}

    if (root.style.display === 'block' && assistantOwnsScan()) {
      setTimeout(function () {
        try { capture.focus({ preventScroll: true }); } catch (e) { try { capture.focus(); } catch (e2) {} }
      }, 20);
    } else {
      releaseFocusToPims();
    }
  }

  function startNdcPhase() {
    clearInterval(state.poPollTimer);
    state.phase = 'NDC'; state.ndc = ''; state.drug = ''; state.pos = [];
    render();
  }

  // Scan an NDC -> drive the PIMS Inventory search -> read Incoming Purchases.
  function onNdcScan(raw) {
    tone(true);
    setDebug('NDC scan: ' + raw);
    state.phase = 'PO'; state.pos = [];
    state.ndc = scanToNdc11(raw) || digitsOnly(raw);
    setPimsSearch(raw);                 // drive PIMS Inventory search + Submit
    render();
    clearInterval(state.poPollTimer); state.poPollTries = 0;
    state.poPollTimer = setInterval(function () {
      state.poPollTries++;
      if (state.phase !== 'PO') { clearInterval(state.poPollTimer); return; }
      var ndcNow = currentResultNdc(); if (ndcNow) state.ndc = ndcNow;
      var drugNow = currentResultDrug(); if (drugNow) state.drug = drugNow;
      var pos = readPurchaseOrders();
      if (pos.length) { state.pos = pos; clearInterval(state.poPollTimer); render(); }
      else if (state.poPollTries > 20) { clearInterval(state.poPollTimer); render(); }
      else if (state.poPollTries % 3 === 0) { render(); }
    }, 400);
  }

  function choosePo(p) {
    tone(true);
    setDebug('PO: ' + p.po);
    // Persist intent so that when PIMS navigates to the PO receiving page and
    // this script re-injects on the fresh document, we auto-resume in RECEIVE.
    try { sessionStorage.setItem('ptx7_rx_resume', JSON.stringify({ po: p.po, at: Date.now() })); } catch (e) {}
    state.phase = 'RECEIVE';
    state.lastSignature = '';
    // Open the PO's receiving page (prefer a real link; fall back to click).
    try {
      var fresh = readPurchaseOrders().find(function (x) { return x.po === p.po; });
      var target = (fresh && fresh.target) || p.target;
      var anchor = target && (target.matches && target.matches('a[href]') ? target :
        (target.querySelector && target.querySelector('a[href]')) || (target.closest && target.closest('a[href]')));
      if (anchor && anchor.href) { location.assign(anchor.href); return; }
      else if (target && target.click) { target.click(); }
    } catch (e) {}
    // SPA click (no reload): render the receive screen now.
    setTimeout(render, 400);
    setTimeout(render, 1200);
  }

  // Continuously mirror PIMS. A page-driven watchdog keeps the phase correct:
  // once PIMS is on a PO receiving page, we must be in RECEIVE (so item scans
  // are released to PIMS, not treated as a new NDC lookup). This handles both
  // SPA navigation and full reloads regardless of the resume flag/timing.
  function startMirror() {
    clearInterval(state.mirrorTimer);
    state.mirrorTimer = setInterval(function () {
      if (root.style.display !== 'block') return;

      // Watchdog: sync phase to the page.
      if (onReceivingPage()) {
        if (state.phase !== 'RECEIVE') {
          state.phase = 'RECEIVE';
          state.lastSignature = '';
          try { sessionStorage.removeItem('ptx7_rx_resume'); } catch (e) {}
          render();   // render() also releases scan ownership to PIMS
        }
      }

      if (state.phase !== 'RECEIVE') return; // NDC/PO phases manage their own UI
      var detail = currentReceiveDetail();
      var prog = currentProgress();
      // Include progress + pending detail so the count never goes stale.
      var sig = currentPo() + '|' +
        (prog ? prog.received + '/' + prog.total : '?') + '|' +
        (detail ? (detail.ndc + '@' + detail.location) : 'idle');
      if (sig !== state.lastSignature) {
        var prev = state.lastSignature;
        state.lastSignature = sig;
        // Confirmation feedback only on real PIMS transitions:
        if (prev) {
          var wasPending = /@/.test(prev.split('|')[2] || '');
          var nowPending = !!detail;
          if (!wasPending && nowPending) tone(true);       // item accepted -> location
          else if (wasPending && !nowPending) tone(true);  // location submitted -> confirmed
        }
        render();
      }
    }, 500);
  }

  // ---------------------------------------------------------------------------
  // Deliver a captured scan into PIMS.
  //
  // The PM86 does NOT deliver raw scans to the WebView unless a field is
  // focused, so we captured the scan ourselves. PIMS's receiving listener is
  // keystroke-based (a Zebra wedge works), so we must put the value into the
  // element PIMS listens on. Synthetic body key events are untrusted and
  // ignored, so instead we target an actual input: focus it, set its value via
  // the native setter (so React/Cloudscape sees it), fire 'input', then Enter.
  // ---------------------------------------------------------------------------

  // Enumerate real PIMS inputs (excluding our overlay), for delivery + probe.
  function pimsInputs() {
    return [].slice.call(document.querySelectorAll('input,textarea')).filter(function (el) {
      return !(el.closest && el.closest('#ptx7-rx-root'));
    });
  }

  // Best candidate input for a scan on the current PIMS page.
  function pimsScanInput() {
    var ins = pimsInputs();
    // 1) Whatever PIMS currently has focused.
    var active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') &&
        !(active.closest && active.closest('#ptx7-rx-root'))) return active;
    // 2) A visible search/scan box by placeholder/aria.
    var byPlaceholder = ins.filter(isVisible).find(function (el) {
      var p = (el.getAttribute('placeholder') || el.getAttribute('aria-label') || '').toLowerCase();
      return /scan|product id|enter an ndc|dispensable|medication name|search/.test(p);
    });
    if (byPlaceholder) return byPlaceholder;
    // 3) First enabled visible text input.
    return ins.filter(isVisible).find(function (el) { return !el.disabled && !el.readOnly; }) || null;
  }

  // Deliver the full barcode payload into PIMS by replaying it the way PIMS's
  // scanner listener expects (reverse-engineered via DevTools):
  //   - keypress events on `document` (it reads String.fromCharCode(e.which))
  //   - target must NOT be an INPUT/TEXTAREA/contenteditable (else ignored)
  //   - >= 6 chars, delivered FAST (elapsed first->last < len*30ms); a tight
  //     synchronous loop is ~0ms, well under the threshold
  //   - terminated by Enter (which=13)
  //   - full payload preserved (colons/control chars/serial/lot/exp)
  // No isTrusted requirement, so synthetic keypress events are accepted.
  function deliverScanToPims(payload) {
    // Ensure no editable element is the event target, or PIMS ignores it.
    try {
      var ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) {
        ae.blur();
      }
    } catch (e) {}

    var target = document; // PIMS listens at the document level

    function fireKeypress(ch) {
      var code = ch.charCodeAt(0);
      var ev;
      try {
        ev = new KeyboardEvent('keypress', {
          key: ch, charCode: code, keyCode: code, which: code,
          bubbles: true, cancelable: true
        });
      } catch (e1) {
        // Fallback for engines that ignore the KeyboardEvent 'which' init.
        ev = document.createEvent('Event');
        ev.initEvent('keypress', true, true);
      }
      // Force which/keyCode in case the constructor dropped them (WebView).
      try {
        Object.defineProperty(ev, 'which', { get: function () { return code; } });
        Object.defineProperty(ev, 'keyCode', { get: function () { return code; } });
        Object.defineProperty(ev, 'charCode', { get: function () { return code; } });
      } catch (e2) {}
      target.dispatchEvent(ev);
    }

    // Fast synchronous burst = tiny elapsed time (passes len*30ms rule).
    for (var i = 0; i < payload.length; i++) fireKeypress(payload.charAt(i));
    // Terminator: Enter (which=13).
    fireKeypress(String.fromCharCode(13));

    return 'doc-keypress x' + payload.length;
  }

  // Diagnostic probe: list PIMS inputs so we can see what PIMS listens on.
  function probePimsInputs() {
    var ins = pimsInputs();
    if (!ins.length) return 'no PIMS inputs found';
    return ins.slice(0, 6).map(function (el, i) {
      var vis = isVisible(el) ? 'vis' : 'hid';
      var ph = el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.id || el.name || el.tagName;
      var foc = (el === document.activeElement) ? '*FOCUSED*' : '';
      return (i + 1) + ':' + vis + ':' + ph + foc;
    }).join(' | ');
  }

  // Last captured scan (for diagnostics only; shows length + control chars, not
  // routinely logged elsewhere).
  var lastScanInfo = { len: 0, escaped: '', at: 0, method: '' };
  function escapeCtl(s) {
    return String(s || '').replace(/[\u0000-\u001f]/g, function (c) {
      return '<' + c.charCodeAt(0).toString(16).padStart(2, '0') + '>';
    });
  }

  // Build a copyable diagnostic report that identifies the failing layer.
  function buildDiagnostic() {
    var ae = document.activeElement;
    var aeDesc = ae ? ((ae.closest && ae.closest('#ptx7-rx-root')) ? 'overlay:' : 'pims:') +
      (ae.tagName + (ae.id ? '#' + ae.id : '') +
        (ae.getAttribute && ae.getAttribute('placeholder') ? '[' + ae.getAttribute('placeholder') + ']' : '')) : 'none';
    var detail = currentReceiveDetail();
    var prog = currentProgress();
    var lines = [
      'PTX7 Receive diagnostic',
      'script: v45-diag',
      'route: ' + location.pathname + location.search,
      'phase: ' + state.phase,
      'focusMode: ' + (state.releaseFocus ? 'RELEASED (scan goes to PIMS)' : 'CAPTURED (overlay input)'),
      'activeElement: ' + aeDesc,
      'currentPo: ' + (currentPo() || '(none)'),
      'progress: ' + (prog ? prog.received + '/' + prog.total : '(none)'),
      'receivePanel: ' + (detail ? ('ndc=' + detail.ndc + ' loc=' + detail.location + ' drug=' + (detail.drug || '')) : '(none)'),
      'pimsInputs: ' + probePimsInputs(),
      'lastScan: len=' + lastScanInfo.len + ' method=' + lastScanInfo.method +
        ' payload=' + lastScanInfo.escaped
    ];
    return lines.join('\n');
  }

  function handleScan(scanned) {
    scanned = String(scanned || '').trim();
    if (!scanned) return;
    lastScanInfo = { len: scanned.length, escaped: escapeCtl(scanned), at: Date.now(), method: '' };
    if (state.phase === 'NDC') {
      setDebug('NDC scan: ' + scanned.length + 'ch');
      onNdcScan(scanned);
    } else if (state.phase === 'RECEIVE') {
      // The PM86 only yields scan data via our focused input, so we capture it;
      // then replay the FULL payload as document keypress events the way PIMS's
      // scanner listener accepts (item scan OR location scan — PIMS decides
      // which based on its own receive state). Do NOT reduce to NDC.
      var method = deliverScanToPims(scanned);
      lastScanInfo.method = method;
      setDebug('deliver ' + scanned.length + 'ch via ' + method);
      // Reflect PIMS's resulting state (item accepted -> location, or submitted).
      setTimeout(render, 300);
      setTimeout(render, 900);
      setTimeout(render, 1600);
    } else {
      // PO selection is tap-only.
      lastScanInfo.method = 'ignored (PO select is tap-only)';
      setDebug('Tap the correct PO above (or SCAN A DIFFERENT NDC).');
    }
  }

  // ---------------------------------------------------------------------------
  // Focused capture input (the PM86 wedge commits text into a focused field).
  // ---------------------------------------------------------------------------
  // NOTE: We previously switched the page viewport to device-width here to make
  // the overlay bigger, but that reflow broke the wedge capture focus. Reverted
  // to a no-op so the working scanner is preserved. Larger fixed fonts remain.
  function scaleToScreen() { /* intentionally no-op (do not touch viewport) */ }
  function restoreViewport() { /* no-op */ }

  // On the PM86 the scanner only yields data into a focused input, so the
  // assistant must capture during NDC lookup AND during RECEIVE. The crucial
  // detail (from the reverse-engineered PIMS listener): the capture input is
  // ONLY focused momentarily to receive the wedge text; delivery to PIMS is
  // then done via document keypress events with no editable target. During PO
  // selection the assistant does not own the scan (tap-only).
  function assistantOwnsScan() {
    if (state.releaseFocus) return false;        // diagnostic override
    return state.phase === 'NDC' || state.phase === 'RECEIVE';
  }
  function releaseFocusToPims() {
    try { if (document.activeElement === capture) capture.blur(); } catch (e) {}
  }

  function focusCapture() {
    if (root.style.display !== 'block') return;
    if (!assistantOwnsScan()) { releaseFocusToPims(); return; }
    try { capture.focus({ preventScroll: true }); } catch (e) { try { capture.focus(); } catch (e2) {} }
  }
  capture.addEventListener('blur', function () {
    if (root.style.display === 'block' && assistantOwnsScan()) setTimeout(focusCapture, 10);
  });
  root.addEventListener('click', function () { setTimeout(focusCapture, 0); });
  capture.addEventListener('input', function () {
    if (!assistantOwnsScan()) { capture.value = ''; return; }
    setDebug('Scanning: ' + capture.value);
    clearTimeout(state.captureTimer);
    state.captureTimer = setTimeout(function () {
      var s = capture.value.trim(); capture.value = '';
      if (s) handleScan(s);
    }, 160);
  });
  capture.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      clearTimeout(state.captureTimer);
      var s = capture.value.trim(); capture.value = '';
      if (s) handleScan(s);
    }
  });

  document.getElementById('ptx7-rx-back').onclick = function () { window.__ptx7Rx.close(); };

  // ---------------------------------------------------------------------------
  // Public bridge used by the Android host
  // ---------------------------------------------------------------------------
  window.__ptx7Rx = {
    open: function () {
      window.__ptx7RxReopen = false;
      root.style.display = 'block';
      // If PIMS is already on a PO receiving page, open straight into RECEIVE
      // so a tap on RECEIVE while inside a PO doesn't force a new NDC lookup.
      if (onReceivingPage()) {
        state.phase = 'RECEIVE';
      } else {
        state.phase = 'NDC'; state.ndc = ''; state.drug = ''; state.pos = [];
      }
      state.lastSignature = '';
      capture.value = '';
      try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
      window.scrollTo(0, 0);
      scaleToScreen();
      render();
      startMirror();
      setTimeout(focusCapture, 50);
      setTimeout(focusCapture, 300);
    },
    close: function () {
      root.style.display = 'none';
      clearInterval(state.mirrorTimer);
      clearInterval(state.poPollTimer);
      restoreViewport();
      if (window.PTX7Host && window.PTX7Host.onReceivingClosed) {
        try { window.PTX7Host.onReceivingClosed(); } catch (e) {}
      }
    },
    isOpen: function () { return root.style.display === 'block'; },
    isReceivingPage: function () { return onReceivingPage(); },
    normalizeNdc: function (raw) { return scanToNdc11(raw); },
    // Native host path: Android captured a full hardware-wedge scan and hands
    // it to us. Forward it into PIMS and mirror.
    onHostScan: function (scanned) {
      if (root.style.display !== 'block') return;
      handleScan(String(scanned || ''));
    },
    onHostScanDiag: function (scanned, diag) {
      setDebug('SCAN ' + String(scanned || '') + '  ' + String(diag || ''));
    },
    // Reopen directly in the RECEIVE phase (used after navigating into a PO).
    openInReceive: function () {
      window.__ptx7RxReopen = false;
      root.style.display = 'block';
      state.phase = 'RECEIVE';
      state.lastSignature = '';
      capture.value = '';
      try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
      window.scrollTo(0, 0);
      render();
      startMirror();
      setTimeout(focusCapture, 50);
      setTimeout(focusCapture, 300);
    }
  };

  // Auto-resume: after choosing a PO, PIMS navigates to the receiving page and
  // this script re-injects on the fresh document. Resume into RECEIVE once the
  // receiving page is actually ready (poll, don't guess with a fixed delay).
  try {
    var resumeRaw = sessionStorage.getItem('ptx7_rx_resume');
    if (resumeRaw) {
      var resume = JSON.parse(resumeRaw);
      if (resume && (Date.now() - Number(resume.at || 0) < 60000)) {
        var tries = 0;
        var resumeTimer = setInterval(function () {
          tries++;
          if (onReceivingPage()) {
            clearInterval(resumeTimer);
            try { sessionStorage.removeItem('ptx7_rx_resume'); } catch (e) {}
            window.__ptx7Rx.openInReceive();
          } else if (tries > 40) { // ~20s: give up waiting; keep flag cleared
            clearInterval(resumeTimer);
            try { sessionStorage.removeItem('ptx7_rx_resume'); } catch (e) {}
          }
        }, 500);
      } else {
        try { sessionStorage.removeItem('ptx7_rx_resume'); } catch (e) {}
      }
    }
  } catch (e) {}

  if (window.__ptx7RxReopen) window.__ptx7Rx.open();
})();
