import React from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

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
  return (
    <div className="flex gap-2.5">
      <div className="flex-1 flex flex-col">
        <label className="text-xs text-text-secondary mb-1.5">Start Time:</label>
        <DatePicker
          selected={startDate}
          onChange={onStartChange}
          showTimeSelect
          timeFormat="HH:mm:ss"
          timeIntervals={1}
          dateFormat="MM-dd HH:mm:ss"
          placeholderText="Select start time"
          isClearable
          className="bg-dark-input border border-dark-border text-text-primary px-2 py-2 rounded text-sm focus:outline-none focus:border-accent-blue w-full"
          wrapperClassName="w-full"
          popperClassName="date-picker-popper"
          calendarClassName="date-picker-calendar"
        />
      </div>
      <div className="flex-1 flex flex-col">
        <label className="text-xs text-text-secondary mb-1.5">End Time:</label>
        <DatePicker
          selected={endDate}
          onChange={onEndChange}
          showTimeSelect
          timeFormat="HH:mm:ss"
          timeIntervals={1}
          dateFormat="MM-dd HH:mm:ss"
          placeholderText="Select end time"
          minDate={startDate || undefined}
          isClearable
          className="bg-dark-input border border-dark-border text-text-primary px-2 py-2 rounded text-sm focus:outline-none focus:border-accent-blue w-full"
          wrapperClassName="w-full"
          popperClassName="date-picker-popper"
          calendarClassName="date-picker-calendar"
        />
      </div>
    </div>
  );
};

export default DateTimeRangePicker;
