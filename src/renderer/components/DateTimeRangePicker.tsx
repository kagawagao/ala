import React from 'react';
import { DatePicker } from 'antd';
import dayjs, { Dayjs } from 'dayjs';

const { RangePicker } = DatePicker;

interface DateTimeRangePickerProps {
  startDate: Date | null;
  endDate: Date | null;
  onStartChange: (date: Date | null) => void;
  onEndChange: (date: Date | null) => void;
}

const DateTimeRangePicker: React.FC<DateTimeRangePickerProps> = ({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
}) => {
  const handleChange = (dates: null | (Dayjs | null)[]) => {
    if (!dates) {
      onStartChange(null);
      onEndChange(null);
      return;
    }

    const [start, end] = dates;
    onStartChange(start ? start.toDate() : null);
    onEndChange(end ? end.toDate() : null);
  };

  const value: [Dayjs | null, Dayjs | null] | null = 
    startDate || endDate 
      ? [startDate ? dayjs(startDate) : null, endDate ? dayjs(endDate) : null]
      : null;

  return (
    <div>
      <label style={{ 
        fontSize: '12px', 
        color: 'var(--ant-color-text-secondary)', 
        marginBottom: '6px', 
        display: 'block' 
      }}>
        Time Range:
      </label>
      <RangePicker
        showTime={{
          format: 'HH:mm:ss',
        }}
        format="MM-DD HH:mm:ss"
        placeholder={['Start time', 'End time']}
        value={value}
        onChange={handleChange}
        style={{ width: '100%' }}
        allowClear
      />
    </div>
  );
};

export default DateTimeRangePicker;
